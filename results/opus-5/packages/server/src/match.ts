/**
 * The match: a fixed roster of slots playing best-of-N rounds at 30Hz.
 *
 * MatchRunner owns the authoritative GameState and nothing else. It never
 * touches the database, Elo or XP - it plays the game out and hands back
 * placements, which the gateway turns into ratings and levels. That is also why
 * it runs perfectly happily with zero connected humans, which is exactly what
 * the soak script and bot-filled practice rooms do.
 */

import { randomUUID } from 'node:crypto';
import {
  CONFIG,
  Dir,
  arenaSize,
  createRoundState,
  randomSeed,
  rankPlacements,
  simulateTick,
  soakPlayer,
  tryEmote,
  type AnimalId,
  type BotDifficulty,
  type GameState,
  type HatId,
  type MatchConfig,
  type MatchPlayerInfo,
  type PlayerInput,
  type ServerMessage,
} from '@splash/shared';
import { createBot, type BotController } from './bots/bot.js';
import { slotPlayerInfo, type PlayerLookup, type Room } from './room.js';
import { buildRoundStart, buildSnapshot } from './snapshot.js';

export interface MatchSink {
  send(playerId: string, msg: ServerMessage): void;
  broadcast(msg: ServerMessage): void;
  /** Last measured round-trip time in ms, so the HUD can show everyone's ping. */
  latency(playerId: string): number;
}

export interface MatchSlotResult {
  slot: number;
  playerId: string | null;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  placement: number;
  roundsWon: number;
  soaks: number;
  castles: number;
  bestChain: number;
  survivedTicks: number;
  forfeited: boolean;
}

/** Running per-slot totals across every round of the match. */
interface SlotTotals {
  soaks: number;
  castles: number;
  bestChain: number;
  survivedTicks: number;
}

function emptyTotals(): SlotTotals {
  return { soaks: 0, castles: 0, bestChain: 0, survivedTicks: 0 };
}

export class MatchRunner {
  readonly matchId = randomUUID();
  readonly config: MatchConfig;
  readonly startedAt = Date.now();

  /** Round wins indexed by slot. Empty slots stay at zero. */
  scores: number[];
  roundNo = 0;
  finished = false;

  private readonly sink: MatchSink;
  /** Occupied slots as they were when the whistle blew, ascending. */
  private readonly roster: MatchPlayerInfo[];
  /** Slot -> account id, kept even after a bot takes over, so stats still land. */
  private readonly humans = new Map<number, string>();
  private readonly bots = new Map<number, BotController>();
  private readonly inputs = new Map<number, PlayerInput>();
  /** Ticks since a human last refreshed their input, so silence is not a sprint. */
  private readonly inputAge = new Map<number, number>();
  private readonly acks = new Map<number, number>();
  private readonly totals = new Map<number, SlotTotals>();
  private readonly forfeited = new Set<number>();
  private readonly snapshotEvery: number;

  private state: GameState | null = null;
  private mapSeed = 0;
  private roundResolved = false;
  private matchOver = false;

  constructor(room: Room, lookup: PlayerLookup, sink: MatchSink) {
    this.sink = sink;
    this.scores = new Array<number>(room.maxPlayers).fill(0);
    this.snapshotEvery = Math.max(1, Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE));

    const roster: MatchPlayerInfo[] = [];
    for (let slot = 0; slot < room.maxPlayers; slot++) {
      const info = slotPlayerInfo(room, slot, lookup);
      if (info === null) continue;
      roster.push(info);
      this.totals.set(slot, emptyTotals());
      if (info.isBot) {
        this.bots.set(slot, createBot(slot, info.difficulty ?? 'medium', randomSeed()));
      } else if (info.playerId !== null) {
        this.humans.set(slot, info.playerId);
      }
    }
    this.roster = roster;

    const arena = arenaSize(room.mode);
    this.config = {
      matchId: this.matchId,
      mode: room.mode,
      ranked: room.ranked,
      tutorial: room.tutorial,
      roundsToWin: room.roundsToWin,
      // One theme for the whole match, even when the room says "random".
      theme: room.resolveTheme(),
      width: arena.width,
      height: arena.height,
      yourSlot: -1,
      revengeDucks: room.ranked ? CONFIG.REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS,
      kickEnabled: CONFIG.ENABLE_KICK,
      players: roster,
    };
  }

  // ----------------------------------------------------------------- lifecycle

  /**
   * The seed the current round was generated from. Server-side only, for the
   * soak harness and crash reports: it never crosses the wire, because it
   * regenerates every sandcastle's hidden contents.
   */
  currentMapSeed(): number {
    return this.mapSeed;
  }

  /** Sends match_start to every human, then opens round 1. Call once. */
  begin(): void {
    if (this.roundNo !== 0) return;
    for (const [slot, playerId] of this.humans) {
      this.sink.send(playerId, { t: 'match_start', config: { ...this.config, yourSlot: slot } });
    }
    this.startRound(1);
  }

  /** Advance exactly one 30Hz tick. */
  tick(nowMs: number): void {
    const state = this.state;
    if (state === null || this.finished) return;

    if (state.phase === 'playing') this.driveBots(state, nowMs);

    const events = simulateTick(state, this.inputs);
    this.consumeInputs();

    for (const event of events) this.sink.broadcast({ t: 'event', tick: state.tick, event });
    if (state.tick % this.snapshotEvery === 0) this.sendSnapshots(state);

    if (state.phase !== 'ended') return;
    if (!this.roundResolved) this.resolveRound(state);
    else if (state.tick >= state.phaseEndTick) this.advance();
  }

  private startRound(roundNo: number): void {
    this.roundNo = roundNo;
    this.mapSeed = randomSeed();
    this.roundResolved = false;
    this.inputs.clear();
    this.inputAge.clear();

    this.state = createRoundState({
      mode: this.config.mode,
      seed: this.mapSeed,
      slots: this.activeSlots(),
      revengeDucks: this.config.revengeDucks,
      kickEnabled: this.config.kickEnabled,
    });

    for (const bot of this.bots.values()) bot.reset();
    this.sink.broadcast(buildRoundStart(this.state, roundNo, this.config.theme, this.scores));
  }

  /** Score the round the instant it ends; the freeze that follows is cosmetic. */
  private resolveRound(state: GameState): void {
    this.roundResolved = true;

    for (const player of state.players) {
      const totals = this.totals.get(player.id);
      if (totals === undefined) continue;
      totals.soaks += player.soaks;
      totals.castles += player.castlesWashed;
      totals.bestChain = Math.max(totals.bestChain, player.bestChain);
      totals.survivedTicks += player.survivedTicks;
    }

    // A drawn round (mutual soak, or the tide taking the last two) awards nobody.
    for (const slot of state.winners) {
      if (slot >= 0 && slot < this.scores.length) this.scores[slot]++;
    }

    this.matchOver = this.isMatchOver();
    this.broadcastRoundEnd(state.winners);
  }

  private broadcastRoundEnd(winners: number[]): void {
    this.sink.broadcast({
      t: 'round_end',
      roundNo: this.roundNo,
      winners: [...winners],
      scores: [...this.scores],
      matchOver: this.matchOver,
    });
  }

  private advance(): void {
    // A forfeit during the round-end freeze can decide the match after the fact.
    if (!this.matchOver && this.isMatchOver()) {
      this.matchOver = true;
      this.broadcastRoundEnd(this.state?.winners ?? []);
    }
    if (this.matchOver) {
      this.finished = true;
      return;
    }
    this.startRound(this.roundNo + 1);
  }

  private isMatchOver(): boolean {
    if (this.activeSlots().length <= 1) return true;
    if (this.roundNo >= CONFIG.MAX_ROUNDS) return true;
    return this.scores.some((score) => score >= this.config.roundsToWin);
  }

  private activeSlots(): number[] {
    return this.roster.filter((r) => !this.forfeited.has(r.slot)).map((r) => r.slot);
  }

  // --------------------------------------------------------------------- input

  setInput(slot: number, input: PlayerInput): void {
    const state = this.state;
    if (state === null) return;
    if (!this.humans.has(slot) || this.forfeited.has(slot)) return;

    const player = state.players.find((p) => p.id === slot);
    // Soaked critters still steer their revenge duck; truly dead slots do not.
    if (player === undefined || (!player.alive && !player.ghost)) return;

    // Hearing from a human means they are back: the substitute bot stands down.
    this.bots.delete(slot);
    this.inputAge.set(slot, 0);
    this.inputs.set(slot, {
      seq: input.seq,
      tick: input.tick,
      dir: input.dir,
      balloonPressed: input.balloonPressed,
    });
  }

  private dropInput(slot: number): void {
    this.inputs.delete(slot);
    this.inputAge.delete(slot);
  }

  private driveBots(state: GameState, nowMs: number): void {
    for (const [slot, bot] of this.bots) {
      const player = state.players.find((p) => p.id === slot);
      if (player === undefined || !player.alive) continue;
      const input = bot.update(state, nowMs);
      this.inputs.set(slot, {
        seq: input.seq,
        tick: input.tick,
        dir: input.dir,
        balloonPressed: input.balloonPressed,
      });
    }
  }

  private consumeInputs(): void {
    for (const [slot, input] of this.inputs) {
      const acked = this.acks.get(slot) ?? 0;
      if (input.seq > acked) this.acks.set(slot, input.seq);
      // Bots refill their input every tick, so none of the staleness rules apply.
      if (this.bots.has(slot)) continue;

      // One message, one balloon: holding the key means the client keeps sending.
      input.balloonPressed = false;
      const age = (this.inputAge.get(slot) ?? 0) + 1;
      this.inputAge.set(slot, age);
      // A client that has gone quiet coasts to a stop instead of walking into the tide.
      if (age > CONFIG.INPUT_BUFFER_TICKS) input.dir = Dir.NONE;
    }
  }

  emote(slot: number, emoteId: number): boolean {
    const state = this.state;
    if (state === null) return false;
    const before = state.events.length;
    if (!tryEmote(state, slot, emoteId)) return false;
    this.drainBetweenTicks(state, before);
    return true;
  }

  /**
   * simulateTick clears the event queue before it runs, so anything pushed
   * between ticks has to go out under its own steam.
   */
  private drainBetweenTicks(state: GameState, from: number): void {
    for (let i = from; i < state.events.length; i++) {
      this.sink.broadcast({ t: 'event', tick: state.tick, event: state.events[i] });
    }
    state.events.length = from;
  }

  // -------------------------------------------------------------- disconnects

  /** Casual: the critter keeps playing, just badly. Stats stay with the human. */
  substituteBot(slot: number, difficulty: BotDifficulty): void {
    if (!this.humans.has(slot) || this.forfeited.has(slot)) return;
    if (this.bots.has(slot)) return;
    this.bots.set(slot, createBot(slot, difficulty, randomSeed()));
    this.dropInput(slot);
  }

  /** Ranked: instant soak, last place, and no seat in any remaining round. */
  forfeit(slot: number): void {
    if (!this.humans.has(slot) || this.forfeited.has(slot)) return;
    this.forfeited.add(slot);
    this.bots.delete(slot);
    this.dropInput(slot);

    const state = this.state;
    if (state === null) return;
    const player = state.players.find((p) => p.id === slot);
    if (player === undefined || !player.alive) return;

    const before = state.events.length;
    soakPlayer(state, player, slot, false);
    // Nobody who walked out gets a revenge duck.
    player.ghost = false;
    this.drainBetweenTicks(state, before);
  }

  // -------------------------------------------------------------------- views

  /** Replays the match opening to one slot, for a client that reconnected. */
  resync(slot: number): void {
    const playerId = this.humans.get(slot);
    const state = this.state;
    if (playerId === undefined || state === null) return;

    // A fresh page means a fresh input sequence, so the old ack must not stick.
    this.acks.delete(slot);
    this.dropInput(slot);

    this.sink.send(playerId, { t: 'match_start', config: { ...this.config, yourSlot: slot } });
    this.sink.send(
      playerId,
      buildRoundStart(state, this.roundNo, this.config.theme, this.scores),
    );
    this.sink.send(playerId, { ...buildSnapshot(state, this.scores, this.pings()), ack: 0 });
  }

  /** Round-trip time per slot. Bots and empty slots read 0. */
  private pings(): number[] {
    const pings = new Array<number>(this.config.players.length).fill(0);
    for (const [slot, playerId] of this.humans) {
      pings[slot] = Math.round(this.sink.latency(playerId));
    }
    return pings;
  }

  private sendSnapshots(state: GameState): void {
    if (this.humans.size === 0) return;
    const base = buildSnapshot(state, this.scores, this.pings());
    for (const [slot, playerId] of this.humans) {
      this.sink.send(playerId, { ...base, ack: this.acks.get(slot) ?? 0 });
    }
  }

  /** Final placements, best first. Only meaningful once `finished`. */
  results(): MatchSlotResult[] {
    const active = this.roster.filter((r) => !this.forfeited.has(r.slot));
    const ranked = rankPlacements(
      active.map((r) => ({
        playerId: String(r.slot),
        roundsWon: this.scores[r.slot] ?? 0,
        soaks: this.totalsOf(r.slot).soaks,
      })),
    );
    // Everyone who forfeited shares the place below everyone who stayed. When
    // nobody stayed there is no first place to inherit: walking out is never a
    // win, however many other people walked out with you.
    const lastPlace = Math.max(2, active.length + 1);

    const rows: MatchSlotResult[] = this.roster.map((r) => {
      const totals = this.totalsOf(r.slot);
      const forfeited = this.forfeited.has(r.slot);
      return {
        slot: r.slot,
        playerId: r.playerId,
        nickname: r.nickname,
        tag: r.tag,
        animal: r.animal,
        hat: r.hat,
        isBot: r.isBot,
        placement: forfeited ? lastPlace : (ranked.get(String(r.slot)) ?? lastPlace),
        roundsWon: this.scores[r.slot] ?? 0,
        soaks: totals.soaks,
        castles: totals.castles,
        bestChain: totals.bestChain,
        survivedTicks: totals.survivedTicks,
        forfeited,
      };
    });

    return rows.sort((a, b) => a.placement - b.placement || a.slot - b.slot);
  }

  private totalsOf(slot: number): SlotTotals {
    return this.totals.get(slot) ?? emptyTotals();
  }
}
