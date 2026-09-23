// MatchRunner: one authoritative match. Driven by the global ticker (one tick(now) call = at most
// one sim tick), fully steppable with an injected time for tests.
//
//   start -> intro (MATCH_INTRO_MS) -> countdown (round_start, ROUND_INTRO_MS, inputs ignored)
//   -> live (inputs, bots, simulateTick, events, snapshots) -> settling (ROUND_OVER_DELAY_MS)
//   -> round_end -> between (ROUND_END_MS) -> next round ... -> match_end (persisted)
import { CONFIG, hashSeed, makeRules, simulateTick, snapshotBody } from '@splash/shared';
import type { MatchEndMsg, PlayerInput, RatingDelta, RoundEndMsg, RoundState, S2C, SimRules, XpAward } from '@splash/shared';
import { buildProfile } from './accounts';
import type { Db } from './db';
import { matchConfigFor } from './match/config';
import { InputQueues } from './match/inputs';
import { buildFunStats, buildPlacements, emptyTotals, persistInput, tallyRound, type SlotTotals } from './match/results';
import { createRound, resyncRoundMsgs, roundStartMsg, roundSummaries, type ActiveRound } from './match/rounds';
import type { BotBrain, BotFactory, MatchHooks, MatchParticipant, MatchSetup } from './match/types';
import type { Outbox } from './net/outbox';
import { persistMatchResults } from './results';

export type MatchPhase = 'intro' | 'countdown' | 'live' | 'settling' | 'between' | 'ended';

export interface MatchRunnerDeps {
  db: Db;
  outbox: Outbox;
  createBot: BotFactory;
}

export interface MatchRunnerOptions {
  hooks?: MatchHooks;
  matchIntroMs?: number;
  roundIntroMs?: number;
  /** Called once, right after match_end was sent. */
  onFinished?: (end: MatchEndMsg, now: number) => void;
}

const ROUND_PHASES: ReadonlySet<MatchPhase> = new Set(['countdown', 'live', 'settling']);
/** Phases in which the round's outcome is still open. */
const PLAYING_PHASES: ReadonlySet<MatchPhase> = new Set(['countdown', 'live']);
const BOT_SEED_SALT = 0xb07;

export class MatchRunner {
  readonly rules: SimRules;
  private readonly participants: (MatchParticipant | null)[];
  private readonly inputs: InputQueues;
  private readonly brains = new Map<number, BotBrain>();
  private readonly forfeited = new Set<number>();
  /** Humans who walked away after the result was settled: no more traffic, result unchanged. */
  private readonly departed = new Set<number>();
  private readonly totals: SlotTotals[];
  private readonly scores: number[];
  private current: MatchPhase = 'intro';
  private deadline = 0;
  private round: ActiveRound | null = null;
  private lastRoundEnd: RoundEndMsg | null = null;
  private decided = false;
  private startedAt = 0;
  private endMsg: MatchEndMsg | null = null;
  private readonly failedBots = new Set<number>();

  constructor(
    readonly setup: MatchSetup,
    private readonly deps: MatchRunnerDeps,
    private readonly opts: MatchRunnerOptions = {},
  ) {
    this.rules = makeRules({ ranked: setup.kind === 'ranked', tutorial: setup.kind === 'tutorial' });
    this.participants = Array.from({ length: setup.size }, (_, slot) => setup.participants.find((p) => p.slot === slot) ?? null);
    this.inputs = new InputQueues(setup.size);
    this.totals = emptyTotals(setup.size);
    this.scores = new Array<number>(setup.size).fill(0);
    for (const p of this.participants) if (p && p.playerId === null) this.brains.set(p.slot, this.makeBrain(p));
  }

  get phase(): MatchPhase {
    return this.current;
  }

  get roundNo(): number {
    return this.round?.roundNo ?? 0;
  }

  /** The live round state (null before round 1). */
  get state(): RoundState | null {
    return this.round?.state ?? null;
  }

  /** The match_end message once the match finished. */
  get result(): MatchEndMsg | null {
    return this.endMsg;
  }

  /**
   * True once nothing that happens can change the result: the deciding round is over (settling
   * or between) or the match ended. Leaving from here on is not a forfeit and no bot takes over.
   */
  get outcomeDecided(): boolean {
    if (this.current === 'ended' || (this.current === 'between' && this.decided)) return true;
    if (this.current !== 'settling' || !this.round) return false;
    const { winner } = this.round.state;
    const clinched = winner >= 0 && this.scores[winner] + 1 >= this.setup.roundsToWin;
    return clinched || this.round.roundNo >= CONFIG.MAX_ROUNDS;
  }

  participant(slot: number): MatchParticipant | null {
    return this.participants[slot] ?? null;
  }

  slotOf(playerId: string): number {
    return this.participants.find((p) => p?.playerId === playerId)?.slot ?? -1;
  }

  start(now: number): void {
    this.startedAt = now;
    for (const p of this.recipients()) {
      this.deps.outbox.send(p.playerId!, { type: 'match_start', config: this.configFor(p.slot) });
    }
    this.current = 'intro';
    this.deadline = now + (this.opts.matchIntroMs ?? CONFIG.MATCH_INTRO_MS);
    if (this.deadline <= now) this.startRound(now);
  }

  tick(now: number): void {
    switch (this.current) {
      case 'intro':
        if (now >= this.deadline) this.startRound(now);
        return;
      case 'countdown':
        // Tick 0 is at startTime; the first simulated tick (tick 1) is one period later.
        if (now >= this.round!.startTime + CONFIG.TICK_MS - 1) {
          this.current = 'live';
          this.step(now);
        }
        return;
      case 'live':
        this.step(now);
        return;
      case 'settling':
        this.step(now);
        if (now >= this.deadline) this.endRound(now);
        return;
      case 'between':
        if (now < this.deadline) return;
        if (this.decided) this.finish(now);
        else this.startRound(now);
        return;
      case 'ended':
        return;
    }
  }

  /** Queues a human's input; ignored outside the live phase or when seq does not increase. */
  /**
   * Queues a human's input. Accepted while live, and also in the countdown's final period (after
   * tick 0 at startTime, before the first simulated tick): a client whose clock estimate runs a
   * few ms ahead then still gets its GO press applied on tick 1. Earlier inputs are refused, so a
   * key held during 3-2-1 can never queue a balloon at spawn.
   */
  pushInput(slot: number, input: PlayerInput, now: number): boolean {
    if (this.participants[slot]?.playerId == null) return false;
    const goWindow = this.current === 'countdown' && now >= this.round!.startTime;
    if (this.current !== 'live' && !goWindow) return false;
    return this.inputs.push(slot, input);
  }

  /** A disconnected human idles: queued inputs dropped, no movement until they return. */
  idle(slot: number): void {
    this.inputs.idle(slot);
  }

  /** Casual take-over: the slot is played by a bot from now on (stats and round wins stay). */
  replaceWithBot(slot: number, bot: MatchParticipant): void {
    if (this.current === 'ended' || !this.participants[slot]) return;
    if (this.outcomeDecided) {
      this.release(slot);
      return;
    }
    const participant: MatchParticipant = { ...bot, slot, playerId: null };
    this.participants[slot] = participant;
    this.inputs.idle(slot);
    this.brains.set(slot, this.makeBrain(participant));
  }

  /** Re-seeds a bot's plan (the tutorial respawns its bot). */
  resetBrain(slot: number): void {
    this.brains.get(slot)?.reset();
  }

  /**
   * Ranked forfeit: the slot leaves the match for good (removed from the current round if it is
   * still being played, absent from later rounds, placed last). Ends the match when fewer than
   * two remain. Once the outcome is decided a leaver is only released: the real result stands.
   */
  forfeit(slot: number, now: number): void {
    if (this.current === 'ended' || this.forfeited.has(slot) || !this.participants[slot]) return;
    if (this.outcomeDecided) {
      this.release(slot);
      return;
    }
    this.forfeited.add(slot);
    this.inputs.idle(slot);
    const p = this.round?.state.players[slot];
    if (p?.present && PLAYING_PHASES.has(this.current)) {
      p.present = false;
      p.alive = false;
      p.moving = false;
      p.duckPos = -1;
    }
    if (this.activeCount() < 2) this.finish(now);
  }

  /**
   * A human walks away from a match whose result is settled: they get no further match traffic
   * but keep their placement, XP and rating change (persisted when the match ends).
   */
  release(slot: number): void {
    if (this.participants[slot]?.playerId == null) return;
    this.departed.add(slot);
    this.inputs.idle(slot);
  }

  /**
   * Re-sends match_start and the current round (tiles + resumeTick, plus its outcome while it
   * settles) to a re-attached player, or the last round_end between rounds.
   */
  resync(playerId: string): boolean {
    const slot = this.slotOf(playerId);
    if (slot < 0 || this.current === 'ended' || this.forfeited.has(slot) || this.departed.has(slot)) return false;
    this.inputs.resetSeq(slot);
    this.deps.outbox.send(playerId, { type: 'match_start', config: this.configFor(slot) });
    if (this.round && ROUND_PHASES.has(this.current)) {
      for (const msg of resyncRoundMsgs(this.round, this.scores)) this.deps.outbox.send(playerId, msg);
    } else if (this.current === 'between' && this.lastRoundEnd) {
      this.deps.outbox.send(playerId, this.lastRoundEnd);
    }
    this.opts.hooks?.onResync?.(playerId);
    return true;
  }

  /** Stops the match without results (room torn down). */
  stop(): void {
    this.current = 'ended';
  }

  private configFor(slot: number) {
    const seated = this.participants.filter((p): p is MatchParticipant => p !== null);
    return matchConfigFor(this.setup, this.rules, seated, slot);
  }

  /** Humans still at the table (bot-replaced, forfeited and departed players get no match traffic). */
  private recipients(): MatchParticipant[] {
    return this.participants.filter(
      (p): p is MatchParticipant => p !== null && p.playerId !== null && !this.forfeited.has(p.slot) && !this.departed.has(p.slot),
    );
  }

  private broadcast(msg: S2C): void {
    for (const p of this.recipients()) this.deps.outbox.send(p.playerId!, msg);
  }

  private activeCount(): number {
    return this.participants.filter((p) => p !== null && !this.forfeited.has(p.slot)).length;
  }

  private makeBrain(p: MatchParticipant): BotBrain {
    const seed = hashSeed(this.setup.seed, p.slot, BOT_SEED_SALT, this.roundNo);
    return this.deps.createBot(p.slot, p.difficulty ?? CONFIG.DISCONNECT_BOT_DIFFICULTY, seed, { passive: p.passive === true });
  }

  private startRound(now: number): void {
    const roundNo = this.roundNo + 1;
    const present = this.participants.map((p, slot) => p !== null && !this.forfeited.has(slot));
    const startTime = now + (this.opts.roundIntroMs ?? CONFIG.ROUND_INTRO_MS);
    this.round = createRound({ setup: this.setup, rules: this.rules, roundNo, present, startTime, hooks: this.opts.hooks });
    this.inputs.idleAll();
    for (const [slot, brain] of this.brains) this.guardBot(slot, () => brain.reset());
    this.lastRoundEnd = null;
    this.current = 'countdown';
    this.broadcast(roundStartMsg(this.round, this.scores));
  }

  private step(now: number): void {
    const state = this.round!.state;
    const events = simulateTick(state, this.collectInputs(state));
    this.opts.hooks?.afterTick?.(state, events, now);
    if (events.length > 0) this.broadcast({ type: 'event', tick: state.tick, events });
    if (state.tick % CONFIG.SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots(state, now);
    if (this.current === 'live' && state.over) {
      this.current = 'settling';
      this.deadline = now + CONFIG.ROUND_OVER_DELAY_MS;
    }
  }

  private collectInputs(state: RoundState): (PlayerInput | null)[] {
    return state.players.map((p) => {
      if (!p.present) return null;
      const brain = this.brains.get(p.slot);
      if (brain) return this.guardBot(p.slot, () => brain.nextInput(state));
      return this.inputs.next(p.slot);
    });
  }

  /** A crashing bot idles for the tick instead of taking the room down (logged once per slot). */
  private guardBot<T>(slot: number, run: () => T): T | null {
    try {
      return run();
    } catch (err) {
      if (!this.failedBots.has(slot)) console.error(`[match ${this.setup.matchId}] bot in slot ${slot} failed`, err);
      this.failedBots.add(slot);
      return null;
    }
  }

  private sendSnapshots(state: RoundState, now: number): void {
    const body = snapshotBody(state);
    const pings = this.participants.map((p) => (p?.playerId ? this.deps.outbox.rtt(p.playerId) : -1));
    const serverTime = Math.round(now);
    for (const p of this.recipients()) {
      this.deps.outbox.send(p.playerId!, { type: 'snapshot', ...body, serverTime, ack: this.inputs.ack(p.slot), pings });
    }
  }

  /**
   * Adds a round to the match once: its winner's round win (when the round is over) and every
   * player's stats. A forfeit that ends the match while a round is settling still credits it.
   */
  private creditRound(round: ActiveRound): void {
    if (round.tallied) return;
    const { state } = round;
    if (state.over && state.winner >= 0) this.scores[state.winner]++;
    tallyRound(this.totals, state);
    round.tallied = true;
  }

  private endRound(now: number): void {
    const round = this.round!;
    const state = round.state;
    this.creditRound(round);
    this.decided =
      this.scores.some((s) => s >= this.setup.roundsToWin) || round.roundNo >= CONFIG.MAX_ROUNDS || this.activeCount() < 2;
    this.lastRoundEnd = {
      type: 'round_end',
      roundNo: round.roundNo,
      winner: state.winner,
      scores: [...this.scores],
      summaries: roundSummaries(state),
      matchOver: this.decided,
    };
    this.broadcast(this.lastRoundEnd);
    this.current = 'between';
    this.deadline = now + CONFIG.ROUND_END_MS;
  }

  private finish(now: number): void {
    if (this.current === 'ended') return;
    if (this.round) this.creditRound(this.round);
    this.current = 'ended';
    const placements = buildPlacements(this.participants, this.totals, this.scores, this.forfeited);
    const { ratingDeltas, xp } = this.persist(placements, now);
    this.endMsg = {
      type: 'match_end',
      matchId: this.setup.matchId,
      mode: this.setup.mode,
      ranked: this.setup.kind === 'ranked',
      practice: this.setup.kind === 'practice',
      tutorial: false,
      placements,
      ratingDeltas,
      xp,
      funStats: buildFunStats(placements),
      canRematch: this.setup.kind === 'casual',
    };
    this.broadcast(this.endMsg);
    this.sendProfiles();
    this.opts.onFinished?.(this.endMsg, now);
  }

  private persist(placements: MatchEndMsg['placements'], now: number): { ratingDeltas: RatingDelta[] | null; xp: XpAward[] } {
    try {
      return persistMatchResults(this.deps.db, persistInput(this.setup, placements, this.startedAt, now));
    } catch (err) {
      console.error(`[match ${this.setup.matchId}] could not persist results`, err);
      return { ratingDeltas: null, xp: [] };
    }
  }

  /** XP, levels and ratings changed: every human (forfeiters included) gets a fresh profile. */
  private sendProfiles(): void {
    for (const p of this.participants) {
      if (!p?.playerId) continue;
      try {
        this.deps.outbox.send(p.playerId, { type: 'profile', profile: buildProfile(this.deps.db, p.playerId) });
      } catch (err) {
        console.error(`[match ${this.setup.matchId}] profile refresh failed`, err);
      }
    }
  }
}
