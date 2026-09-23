// Match fixtures for MatchState tests: duel and FFA configs, round_start messages (a generated
// map, or an open arena with boulders on the border only) and a match already in its round.
import { CONFIG, Tile, encodeTiles, generateMap, makeRules, type MatchConfig, type RoundStartMsg } from '@splash/shared';
import { MatchState } from '../src/game/matchState';
import { createSeqCounter } from '../src/prediction';

export const SEED = 1234;
/** startTime (tick 0) of every fixture round. */
export const START = 10_000;

export function duelConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    matchId: 'm-1',
    mode: 'duel',
    ranked: false,
    practice: false,
    tutorial: false,
    roomCode: 'ABC234',
    roundsToWin: 3,
    theme: 'beach',
    w: 13,
    h: 11,
    rules: makeRules({ ranked: false }),
    players: [
      { slot: 0, playerId: 'p-0', name: 'DuckyDan', tag: '0042', isBot: false, animal: 'duck', hat: 'none', level: 3 },
      { slot: 1, playerId: 'p-1', name: 'SoggyCat', tag: '0007', isBot: false, animal: 'cat', hat: 'crown', level: 1 },
    ],
    yourSlot: 0,
    ...overrides,
  };
}

/** A casual four-human FFA. */
export function ffaConfig(): MatchConfig {
  const base = duelConfig().players[0];
  const players = ['DuckyDan', 'SoggyCat', 'Capy', 'Otterly'].map((name, slot) => ({ ...base, slot, playerId: `p-${slot}`, name }));
  return duelConfig({ mode: 'ffa', w: 15, h: 13, players });
}

/** round_start on the generated map of `config`'s mode, with a spawn for every seat. */
export function roundStartFor(config: MatchConfig, overrides: Partial<RoundStartMsg> = {}): RoundStartMsg {
  const map = generateMap(config.mode, SEED);
  return {
    type: 'round_start',
    roundNo: 1,
    mapSeed: 99,
    castleGrid: encodeTiles(map.tiles),
    theme: 'beach',
    w: map.w,
    h: map.h,
    startTime: START,
    spawns: map.spawns.filter((s) => config.players.some((p) => p.slot === s.slot)).map((s) => ({ slot: s.slot, x: s.tx, y: s.ty })),
    scores: config.players.map(() => 0),
    tideStartTick: CONFIG.TIDE_START_TICKS,
    ...overrides,
  };
}

/** A duel round_start on an open 13x11 arena (no castles, no tide), spawns in tiles. */
export function openRoundStart(spawns: { slot: number; x: number; y: number }[]): RoundStartMsg {
  const w = 13;
  const h = 11;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = Tile.Boulder;
  }
  return { ...roundStartFor(duelConfig()), castleGrid: encodeTiles(tiles), w, h, spawns, tideStartTick: 1_000_000 };
}

/** A match whose round_start arrived during the 3-2-1. */
export function matchInRound(config: MatchConfig, rs: RoundStartMsg): MatchState {
  const m = new MatchState(createSeqCounter());
  m.startMatch(config, 0);
  m.startRound(rs, rs.startTime - 3000);
  return m;
}
