// Round construction and round-level wire messages. Every round gets a fresh secret map seed
// (hashSeed(matchSeed, roundNo)); clients only ever see an independent random cosmetic seed, so
// nothing sent to them is derived from the secret seed.
import { randomInt, randomFillSync } from 'node:crypto';
import {
  createRoundState,
  encodeTiles,
  generateMap,
  hashSeed,
  mulberry32,
  randInt,
  roundOverEvent,
  survivedTicks,
} from '@splash/shared';
import type {
  GeneratedMap,
  Key128,
  PlayerRoundSummary,
  RoundStartMsg,
  RoundState,
  S2C,
  SimRules,
  Theme,
  ThemeChoice,
} from '@splash/shared';
import type { MatchHooks, MatchSetup } from './types';

const THEMES: readonly Theme[] = ['backyard', 'beach', 'pool'];
const THEME_SALT = 0x7e3e;

export interface ActiveRound {
  roundNo: number;
  state: RoundState;
  map: GeneratedMap;
  theme: Theme;
  /** Decoration seed sent to clients (random, unrelated to the secret map seed). */
  cosmeticSeed: number;
  /** Server time of tick 0 (end of the 3-2-1 intro). */
  startTime: number;
  /** True once the round's stats were added to the match totals. */
  tallied: boolean;
}

/** The round's theme: the room's choice, or a fresh deterministic pick per round for 'random'. */
function pickTheme(choice: ThemeChoice, matchSeed: number, roundNo: number): Theme {
  if (choice !== 'random') return choice;
  return THEMES[randInt(mulberry32(hashSeed(matchSeed, roundNo, THEME_SALT)), THEMES.length)];
}

/** A fresh crypto-random 128-bit key for the round's hidden power-ups (never leaves the server). */
function secretContentKey(): Key128 {
  const words = randomFillSync(new Uint32Array(4));
  return [words[0], words[1], words[2], words[3]];
}

export function createRound(opts: {
  setup: MatchSetup;
  rules: SimRules;
  roundNo: number;
  present: boolean[];
  startTime: number;
  hooks?: MatchHooks;
}): ActiveRound {
  const { setup, roundNo } = opts;
  const mapSeed = hashSeed(setup.seed, roundNo);
  // Hidden power-ups use their own secret random seed (see generateMap): never derivable from
  // the public castle layout.
  const map = opts.hooks?.buildMap ? opts.hooks.buildMap(mapSeed) : generateMap(setup.mode, mapSeed, secretContentKey());
  return {
    roundNo,
    state: createRoundState(map, opts.present, opts.rules),
    map,
    theme: pickTheme(setup.theme, setup.seed, roundNo),
    cosmeticSeed: randomInt(2 ** 31),
    startTime: opts.startTime,
    tallied: false,
  };
}

/**
 * round_start for a round: the CURRENT tile grid (initial at round start, live when resuming)
 * and, when re-joining mid-round, the current tick as `resumeTick`. Spawns are tile coordinates
 * and list only the slots taking part (clients treat a seated slot with a spawn as present, so
 * a forfeited ranked player must not get one).
 */
export function roundStartMsg(round: ActiveRound, scores: readonly number[], resumeTick?: number): RoundStartMsg {
  const s = round.state;
  const spawns = round.map.spawns.filter((sp) => s.players[sp.slot]?.present === true);
  const msg: RoundStartMsg = {
    type: 'round_start',
    roundNo: round.roundNo,
    mapSeed: round.cosmeticSeed,
    castleGrid: encodeTiles(s.tiles),
    theme: round.theme,
    w: s.w,
    h: s.h,
    startTime: Math.round(round.startTime),
    spawns: spawns.map((sp) => ({ slot: sp.slot, x: sp.tx, y: sp.ty })),
    scores: [...scores],
    tideStartTick: s.rules.tideStartTick,
  };
  if (resumeTick !== undefined) msg.resumeTick = resumeTick;
  return msg;
}

/**
 * The round as sent to a player re-attaching while it is on screen: round_start with the live
 * grid and the current tick and, once the round is decided (the settle before round_end), its
 * round_over event again. Neither round_start nor snapshots carry the outcome, so without that
 * event the client would rebuild a finished round as live and keep sending moves the server no
 * longer takes.
 */
export function resyncRoundMsgs(round: ActiveRound, scores: readonly number[]): S2C[] {
  const s = round.state;
  const msgs: S2C[] = [roundStartMsg(round, scores, s.tick)];
  if (s.over) msgs.push({ type: 'event', tick: s.overTick, events: [roundOverEvent(s)] });
  return msgs;
}

export function roundSummaries(state: RoundState): PlayerRoundSummary[] {
  return state.players
    .filter((p) => p.present)
    .map((p) => ({
      slot: p.slot,
      alive: p.alive,
      soaks: p.stats.soaks,
      castles: p.stats.castles,
      biggestChain: p.stats.biggestChain,
      survivedTicks: survivedTicks(state, p),
    }));
}
