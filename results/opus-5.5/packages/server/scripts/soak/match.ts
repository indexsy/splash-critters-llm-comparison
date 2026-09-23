// One headless match: bots only, shared createRoundState + simulateTick, as fast as possible.
// Every tick's inputs and state hash are recorded so the match can be replayed for desyncs, and
// every self-soak is judged forced or unforced (see attribution.ts) while the recording exists.
import { CONFIG, simulateTick, stateHash, type PlayerInput, type RoundState } from '@splash/shared';
import type { BotBrain } from '../../src/bots/bot';
import { forcedBy, type ForcedBy, type RoundSource, type SelfSoak } from './attribution';
import { BalloonLog } from './balloonLog';
import { emptyHistogram, recordCall, timeCall, type CpuHistogram } from './cpu';
import { FreezeWatch, type FreezeEvent } from './freeze';
import { ROUND_TICK_CAP, createMatchBots, decodeInput, encodeInput, newRound, type MatchSpec } from './round';
import { matchLabel } from './suites';

export { ROUND_TICK_CAP, matchRules, type MatchSpec } from './round';

/**
 * The state hash is recorded every HASH_EVERY ticks and after the last tick. Any divergence shows
 * up in the next sample (the hash covers the whole state, and the final one closes the round).
 */
const HASH_EVERY = 10;

function hashed(t: number, ticks: number): boolean {
  return t % HASH_EVERY === 0 || t === ticks - 1;
}

export interface SoakRecord {
  slot: number;
  by: number;
  cause: 'splash' | 'tide' | 'revenge';
  tick: number;
  /** Owner of the balloon that seeded the cascade whose splash soaked the player (-1 = tide). */
  seedOwner: number;
  /** Self-soaks only: how an opponent forced it (see attribution.ts); null for the victim's own blunder. */
  forcedBy: ForcedBy | null;
}

export interface RoundRecord {
  roundNo: number;
  mapSeed: number;
  ticks: number;
  /** Winning slot, -1 for a draw. */
  winner: number;
  stalled: boolean;
  /** The round's last soak(s) came from the rising tide. */
  tideDecided: boolean;
  soaks: SoakRecord[];
  freezes: FreezeEvent[];
  /** dir | balloon << 3, one byte per slot per tick. */
  inputs: Uint8Array;
  /** stateHash after tick t, for every sampled t (see HASH_EVERY); 0 elsewhere. */
  hashes: Uint32Array;
}

export interface MatchResult {
  spec: MatchSpec;
  rounds: RoundRecord[];
  roundsWon: number[];
  /** Match winner slot (first to roundsToWin, else placement by wins then soaks); -1 = tie. */
  winner: number;
  crash: string | null;
  /** Timed specs only: CPU per bot decision call. */
  cpu: CpuHistogram | null;
}

/** Judges every self-soak of a finished round against its recording. */
function attributeSelfSoaks(spec: MatchSpec, round: RoundRecord, selfSoaks: SelfSoak[]): void {
  const source: RoundSource = { start: () => newRound(spec, round.roundNo).state };
  for (const soak of selfSoaks) {
    const record = round.soaks.find((k) => k.slot === soak.slot && k.tick === soak.tick);
    if (record) record.forcedBy = forcedBy(source, round.inputs, soak);
  }
}

/** This tick's inputs; with a histogram, every bot's decision call is timed into it. */
function askBots(bots: (BotBrain | null)[], state: RoundState, cpu: CpuHistogram | null, spec: MatchSpec, round: number): (PlayerInput | null)[] {
  if (!cpu) return bots.map((bot) => (bot ? bot.nextInput(state) : null));
  const tick = state.tick;
  return bots.map((bot, slot) => {
    if (!bot) return null;
    const { value: input, timing } = timeCall(() => bot.nextInput(state));
    recordCall(cpu, timing, () => ({ match: matchLabel(spec), round, tick, slot }));
    return input;
  });
}

function playRound(spec: MatchSpec, roundNo: number, bots: (BotBrain | null)[], cpu: CpuHistogram | null): RoundRecord {
  const { state, mapSeed } = newRound(spec, roundNo);
  const slots = spec.bots.length;
  for (const bot of bots) bot?.reset();
  const inputs = new Uint8Array(ROUND_TICK_CAP * slots);
  const hashes = new Uint32Array(ROUND_TICK_CAP);
  const soaks: SoakRecord[] = [];
  const selfSoaks: SelfSoak[] = [];
  const watch = new FreezeWatch(state, spec.dummies.map((dummy) => dummy === null));
  const log = new BalloonLog();
  let t = 0;
  while (!state.over && t < ROUND_TICK_CAP) {
    const tickInputs = askBots(bots, state, cpu, spec, roundNo);
    for (let slot = 0; slot < slots; slot++) inputs[t * slots + slot] = encodeInput(tickInputs[slot]);
    const events = simulateTick(state, tickInputs);
    log.observe(state.tick, events);
    for (const e of events) {
      if (e.type !== 'player_soaked') continue;
      const facts = log.factsOf(events, e, state.tick);
      soaks.push({ slot: e.slot, by: e.by, cause: e.cause, tick: state.tick, seedOwner: facts.seedOwner, forcedBy: null });
      if (e.by === e.slot) selfSoaks.push({ slot: e.slot, tick: state.tick, facts });
    }
    if (t % HASH_EVERY === 0) hashes[t] = stateHash(state);
    watch.observe(state);
    t++;
  }
  if (t > 0) hashes[t - 1] = stateHash(state);
  const lastTick = soaks.length > 0 ? soaks[soaks.length - 1].tick : -1;
  const finalSoaks = soaks.filter((k) => k.tick === lastTick);
  const round: RoundRecord = {
    roundNo,
    mapSeed,
    ticks: t,
    winner: state.over ? state.winner : -1,
    stalled: !state.over,
    tideDecided: finalSoaks.length > 0 && finalSoaks.every((k) => k.cause === 'tide'),
    soaks,
    freezes: watch.events,
    inputs: inputs.slice(0, t * slots),
    hashes: hashes.slice(0, t),
  };
  attributeSelfSoaks(spec, round, selfSoaks);
  return round;
}

/** Round wins first, then total soaks of opponents; -1 when the top is tied. */
function matchWinner(spec: MatchSpec, rounds: RoundRecord[], roundsWon: number[]): number {
  const soaksBy = spec.bots.map(() => 0);
  for (const r of rounds) for (const k of r.soaks) if (k.by >= 0 && k.by !== k.slot && k.cause === 'splash') soaksBy[k.by]++;
  const ranked = spec.bots
    .map((d, slot) => ({ slot, present: d !== null, wins: roundsWon[slot], soaks: soaksBy[slot] }))
    .filter((r) => r.present)
    .sort((a, b) => b.wins - a.wins || b.soaks - a.soaks);
  if (ranked.length > 1 && ranked[0].wins === ranked[1].wins && ranked[0].soaks === ranked[1].soaks) return -1;
  return ranked[0].slot;
}

export function runMatch(spec: MatchSpec): MatchResult {
  const bots = createMatchBots(spec);
  const roundsWon = spec.bots.map(() => 0);
  const rounds: RoundRecord[] = [];
  const cpu = spec.timed ? emptyHistogram() : null;
  try {
    for (let roundNo = 1; roundNo <= CONFIG.MAX_ROUNDS; roundNo++) {
      const round = playRound(spec, roundNo, bots, cpu);
      rounds.push(round);
      if (round.winner >= 0) roundsWon[round.winner]++;
      if (round.stalled || Math.max(...roundsWon) >= spec.roundsToWin) break;
    }
  } catch (err) {
    const crash = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return { spec, rounds, roundsWon, winner: -1, crash, cpu };
  }
  return { spec, rounds, roundsWon, winner: matchWinner(spec, rounds, roundsWon), crash: null, cpu };
}

/** Re-simulates every recorded round from its seed and inputs; returns the number of desynced rounds. */
export function replayMatch(result: MatchResult): number {
  const slots = result.spec.bots.length;
  let desyncs = 0;
  for (const round of result.rounds) {
    const { state } = newRound(result.spec, round.roundNo);
    for (let t = 0; t < round.ticks; t++) {
      const inputs = [];
      for (let slot = 0; slot < slots; slot++) inputs.push(decodeInput(round.inputs[t * slots + slot], t + 1));
      simulateTick(state, inputs);
      if (hashed(t, round.ticks) && stateHash(state) !== round.hashes[t]) {
        desyncs++;
        break;
      }
    }
  }
  return desyncs;
}

/** A played and replay-verified match, stripped of the bulky per-tick recordings. */
export interface MatchOutcome {
  result: MatchResult;
  desyncs: number;
  ms: number;
}

/** Plays a match, replays it from its seeds and recorded inputs, and summarizes it. */
export function playAndVerify(spec: MatchSpec): MatchOutcome {
  const started = performance.now();
  const result = runMatch(spec);
  const desyncs = result.crash ? 0 : replayMatch(result);
  for (const round of result.rounds) {
    round.inputs = new Uint8Array(0);
    round.hashes = new Uint32Array(0);
  }
  return { result, desyncs, ms: performance.now() - started };
}
