// What a soak match is and how each of its rounds starts: the rules, the round's map and state,
// the match's bots and the compact per-tick input encoding. Shared by the match runner, its replay
// check and the self-soak attribution replays.
import {
  CONFIG,
  createRoundState,
  generateMap,
  hashSeed,
  makeRules,
  type Difficulty,
  type Mode,
  type PlayerInput,
  type RoundState,
  type SimRules,
} from '@splash/shared';
import { createBot, type BotBrain } from '../../src/bots/bot';
import { createDummy, type Dummy } from './dummy';

/** Every walkable ring is flooded by then; a round still running is a stall. */
export const ROUND_TICK_CAP = CONFIG.TIDE_START_TICKS + 40 * CONFIG.TIDE_INTERVAL_TICKS;

export interface MatchSpec {
  suite: string;
  index: number;
  mode: Mode;
  /** Per slot: a bot of that difficulty, or null for an empty slot. */
  bots: (Difficulty | null)[];
  /** Per slot: a practice target playing that slot instead of the bot (see dummy.ts), or null. */
  dummies: (Dummy | null)[];
  seed: number;
  roundsToWin: number;
  /** Time every bot decision (for the bot CPU report). */
  timed: boolean;
}

/** Casual rules: the tide and revenge ducks are on. */
export function matchRules(): SimRules {
  return makeRules({ ranked: false });
}

/** The fresh state of a match round (same map and state every time for the same spec and round). */
export function newRound(spec: MatchSpec, roundNo: number): { state: RoundState; mapSeed: number } {
  const mapSeed = hashSeed(spec.seed, roundNo, 0x5eed);
  const present = spec.bots.map((d) => d !== null);
  return { state: createRoundState(generateMap(spec.mode, mapSeed), present, matchRules()), mapSeed };
}

/** The match's bots, freshly created (the match resets them at the start of every round). */
export function createMatchBots(spec: MatchSpec): (BotBrain | null)[] {
  return spec.bots.map((d, slot) => {
    if (!d) return null;
    const seed = hashSeed(spec.seed, slot, 0xb07);
    const dummy = spec.dummies[slot];
    return dummy ? createDummy(dummy, slot, seed) : createBot(slot, d, seed);
  });
}

/** One byte per slot per tick: dir | balloon << 3, 0xff for no input. */
export function encodeInput(input: PlayerInput | null): number {
  return input ? input.dir | (input.balloon ? 8 : 0) : 0xff;
}

export function decodeInput(code: number, seq: number): PlayerInput | null {
  return code === 0xff ? null : { seq, dir: (code & 7) as PlayerInput['dir'], balloon: (code & 8) !== 0 };
}
