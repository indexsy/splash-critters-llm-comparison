/**
 * Match runtime — drives one match (best-of-N rounds) forward one server tick
 * at a time under the central game loop. Builds snapshots (15Hz), streams events
 * (30Hz), resolves round/match end, and hands final results to results.ts.
 */

import {
  CONFIG,
  applyEmote,
  createRoundState,
  hashStringToSeed,
  mixSeeds,
  resolveTheme,
  simulateTick,
  type GameState,
  type MapTheme,
  type MatchConfig,
  type PlayerInput,
  type RoundPlayerDTO,
  type SimEvent,
  type Snapshot,
} from '@splash/shared';
import { BotController } from './bots/bot';
import type { ServerContext } from './context';
import { finalizeMatch } from './results';
import type { Room } from './room';
import type { Slot } from './roomTypes';

type Phase = 'intro' | 'playing' | 'roundover' | 'ended';

const ROUND_OVER_DELAY = Math.round(2.5 * CONFIG.TICK_RATE);

export class Match {
  readonly room: Room;
  readonly ctx: ServerContext;
  readonly config: MatchConfig;
  readonly baseSeed: number;
  readonly theme: MapTheme;
  readonly startedAtMs: number;

  state: GameState;
  roundNo = 1;
  phase: Phase = 'intro';
  private phaseUntil = 0; // global tick the current timed phase ends

  roundWins: number[];
  // cumulative match stats per slot
  totalSoaks: number[];
  totalCastles: number[];
  survivalTicks: number[];
  biggestChain = 0;
  biggestChainSlot = -1;
  private lastEmoteTick: number[];

  ended = false;

  constructor(room: Room, ctx: ServerContext, config: MatchConfig) {
    this.room = room;
    this.ctx = ctx;
    this.config = config;
    this.baseSeed = hashStringToSeed(room.code);
    this.theme = resolveTheme(config.theme, this.baseSeed);
    this.startedAtMs = ctx.wallClock();
    const n = config.players.length;
    this.roundWins = new Array(n).fill(0);
    this.totalSoaks = new Array(n).fill(0);
    this.totalCastles = new Array(n).fill(0);
    this.survivalTicks = new Array(n).fill(0);
    this.lastEmoteTick = new Array(n).fill(-9999);
    this.state = this.spawnRound(ctx.tick);
  }

  private spawnRound(globalTick: number): GameState {
    const mapSeed = mixSeeds(this.baseSeed, this.roundNo);
    const state = createRoundState({
      mode: this.config.mode,
      mapSeed,
      roundNo: this.roundNo,
      revengeEnabled: this.config.revengeEnabled,
      players: this.config.players.map((p) => ({
        id: p.id,
        slot: p.slot,
        name: p.name,
        animal: p.animal,
        hat: p.hat,
        isBot: p.isBot,
        botDifficulty: p.botDifficulty,
        roundWins: this.roundWins[p.slot] ?? 0,
        connected: true,
      })),
    });
    // forfeited players start each round already eliminated
    for (const slot of this.room.slots) {
      if (slot.forfeited) {
        const pl = state.players.find((p) => p.slot === slot.index);
        if (pl) pl.alive = false;
      }
    }
    this.phase = 'intro';
    this.phaseUntil = globalTick + CONFIG.ROUND_INTRO_TICKS;
    return state;
  }

  private announceRoundStart(): void {
    const players: RoundPlayerDTO[] = this.config.players;
    this.room.broadcast({
      type: 'round_start',
      roundNo: this.roundNo,
      mapSeed: this.state.mapSeed,
      theme: this.theme,
      startAtTick: CONFIG.ROUND_INTRO_TICKS,
      players,
    });
  }

  /** Called once immediately after construction so clients get round 1. */
  begin(): void {
    this.room.broadcast({ type: 'match_start', config: this.config });
    this.announceRoundStart();
    this.sendSnapshot(this.ctx.wallClock());
  }

  private slotBySlot(slot: number): Slot | undefined {
    return this.room.slots.find((s) => s.index === slot);
  }

  private buildInputs(): Map<string, PlayerInput> {
    const inputs = new Map<string, PlayerInput>();
    for (const slot of this.room.slots) {
      const pid = this.config.players.find((p) => p.slot === slot.index)?.id;
      if (!pid) continue;
      if (slot.bot) {
        inputs.set(pid, slot.bot.step(this.state, this.state.tick));
      } else if (slot.client && slot.client.connected) {
        inputs.set(pid, slot.client.consumeInput());
      }
    }
    return inputs;
  }

  tick(globalTick: number, wallMs: number): void {
    if (this.phase === 'ended') return;

    if (this.phase === 'intro') {
      if (globalTick >= this.phaseUntil) this.phase = 'playing';
      if (globalTick % 2 === 0) this.sendSnapshot(wallMs);
      return;
    }

    if (this.phase === 'roundover') {
      if (globalTick >= this.phaseUntil) this.advanceRoundOrEnd(globalTick);
      return;
    }

    // playing
    const inputs = this.buildInputs();
    const events = simulateTick(this.state, inputs);
    this.accumulate(events);
    if (events.length) this.room.broadcast({ type: 'event', tick: this.state.tick, events });
    if (globalTick % 2 === 0) this.sendSnapshot(wallMs);

    if (this.state.roundOver) {
      this.endRound(globalTick);
    }
  }

  private accumulate(events: SimEvent[]): void {
    for (const p of this.state.players) {
      if (p.alive) this.survivalTicks[p.slot]++;
    }
    let burstSlot = -1;
    for (const e of events) {
      if (e.t === 'balloon_burst' && burstSlot < 0) burstSlot = e.ownerSlot;
      if (e.t === 'chain_burst' && e.count > this.biggestChain) {
        this.biggestChain = e.count;
        this.biggestChainSlot = burstSlot;
      }
    }
  }

  private endRound(globalTick: number): void {
    const winner = this.state.winnerSlot;
    for (const p of this.state.players) {
      this.totalSoaks[p.slot] += p.soaks;
      this.totalCastles[p.slot] += p.castlesWashed;
    }
    if (winner !== null) this.roundWins[winner] = (this.roundWins[winner] ?? 0) + 1;
    this.room.broadcast({
      type: 'round_end',
      roundNo: this.roundNo,
      winnerSlot: winner,
      scores: this.roundWins.map((w, slot) => ({ slot, roundWins: w })),
    });
    this.phase = 'roundover';
    this.phaseUntil = globalTick + ROUND_OVER_DELAY;
  }

  private matchWon(): boolean {
    return this.roundWins.some((w) => w >= this.config.roundsToWin);
  }

  private advanceRoundOrEnd(globalTick: number): void {
    const maxRounds = this.config.roundsToWin * 3 + 2; // guarantees termination even with repeated draws
    if (this.matchWon() || this.activePlayers() <= 1 || this.roundNo >= maxRounds) {
      this.finish();
      return;
    }
    this.roundNo++;
    this.state = this.spawnRound(globalTick);
    this.announceRoundStart();
    this.sendSnapshot(this.ctx.wallClock());
  }

  private activePlayers(): number {
    return this.room.slots.filter(
      (s) => (s.kind === 'human' || s.kind === 'bot') && !s.forfeited,
    ).length;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    const result = finalizeMatch(this.ctx, this);
    this.room.broadcast({ type: 'match_end', result });
    this.room.onMatchEnded();
  }

  // ---- external events driven by the Room ----

  emote(playerId: string, id: number): void {
    if (this.phase === 'ended') return;
    const slot = this.config.players.find((p) => p.id === playerId)?.slot;
    if (slot === undefined) return;
    if (id < 1 || id > 4) return;
    if (this.state.tick - this.lastEmoteTick[slot] < CONFIG.EMOTE_COOLDOWN_TICKS) return;
    this.lastEmoteTick[slot] = this.state.tick;
    applyEmote(this.state, playerId, id);
    this.room.broadcast({ type: 'event', tick: this.state.tick, events: [{ t: 'emote', playerId, emoteId: id }] });
  }

  /** A slot dropped: convert to bot (casual) or forfeit (ranked). */
  handleDrop(slot: Slot, ranked: boolean): void {
    if (this.phase === 'ended') return;
    if (ranked) {
      slot.forfeited = true;
      const pl = this.state.players.find((p) => p.slot === slot.index);
      if (pl) pl.alive = false;
      if (this.activePlayers() <= 1 || this.state.players.filter((p) => p.alive).length <= 1) {
        // let the normal round-over/finish flow resolve next tick
        this.state.roundOver = true;
        this.state.winnerSlot = this.state.players.find((p) => p.alive)?.slot ?? null;
      }
    } else {
      const pid = this.config.players.find((p) => p.slot === slot.index)?.id;
      if (pid) slot.bot = new BotController(pid, CONFIG.DISCONNECT_BOT_DIFFICULTY);
    }
  }

  private sendSnapshot(wallMs: number): void {
    const snap = buildSnapshot(this.state, wallMs);
    this.room.broadcast({ type: 'snapshot', snap });
  }
}

export function buildSnapshot(state: GameState, wallMs: number): Snapshot {
  return {
    tick: state.tick,
    serverTimeMs: wallMs,
    tideLevel: state.tideLevel,
    players: state.players.map((p) => ({
      id: p.id,
      slot: p.slot,
      x: round2(p.x),
      y: round2(p.y),
      facing: p.facing,
      moving: p.moving,
      alive: p.alive,
      activeBalloons: p.activeBalloons,
      maxBalloons: p.maxBalloons,
      range: p.range,
      speed: p.speed,
      hasKick: p.hasKick,
      soaks: p.soaks,
      castlesWashed: p.castlesWashed,
      roundWins: p.roundWins,
      revenge: p.revenge,
      emoteId: p.emoteId,
      emoteUntilTick: p.emoteUntilTick,
      connected: p.connected,
    })),
    balloons: state.balloons.map((b) => ({
      id: b.id,
      owner: b.owner,
      x: round2(b.x),
      y: round2(b.y),
      fuseTick: b.fuseTick,
      range: b.range,
      sliding: b.sliding,
    })),
    splashes: state.splashes.map((s) => ({
      x: s.x,
      y: s.y,
      expiresTick: s.expiresTick,
      ownerSlot: s.ownerSlot,
      center: s.center,
    })),
    powerups: state.powerups.map((p) => ({ x: p.x, y: p.y, type: p.type })),
    revengeLobs: state.revengeLobs.map((l) => ({ id: l.id, x: round2(l.x), y: round2(l.y), dir: l.dir })),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
