// Arena generation. A map is fully determined by (mode, seed): boulder lattice, sandcastles
// and the power-ups pre-rolled inside them. `hidden` is server-only; clients get zeros.
import { CONFIG } from './config';
import { idx } from './grid';
import { hashSeed, mulberry32, sfc32, type Key128 } from './rng';
import { PowerUp, Tile, type Mode, type PowerUpKind } from './types';

export interface GeneratedMap {
  w: number;
  h: number;
  /** TileKind per tile, row-major. */
  tiles: Uint8Array;
  /** PowerUpKind hidden inside each castle (PowerUp.None elsewhere). */
  hidden: Uint8Array;
  spawns: { slot: number; tx: number; ty: number }[];
}

/** Weighted power-up table in PowerUp code order (balloon, range, speed, boots). */
const POWERUP_TABLE: readonly (readonly [PowerUpKind, number])[] = [
  [PowerUp.Balloon, CONFIG.POWERUP_WEIGHTS.balloon],
  [PowerUp.Range, CONFIG.POWERUP_WEIGHTS.range],
  [PowerUp.Speed, CONFIG.POWERUP_WEIGHTS.speed],
  [PowerUp.Boots, CONFIG.POWERUP_WEIGHTS.boots],
];
const POWERUP_TOTAL_WEIGHT = POWERUP_TABLE.reduce((sum, [, weight]) => sum + weight, 0);

/** Corner spawns: slot0 top-left, slot1 bottom-right, slot2 top-right, slot3 bottom-left. */
export function spawnTilesFor(mode: Mode): { slot: number; tx: number; ty: number }[] {
  const { w, h, maxPlayers } = CONFIG.MODES[mode];
  const corners = [
    { slot: 0, tx: 1, ty: 1 },
    { slot: 1, tx: w - 2, ty: h - 2 },
    { slot: 2, tx: w - 2, ty: 1 },
    { slot: 3, tx: 1, ty: h - 2 },
  ];
  return corners.slice(0, maxPlayers);
}

/** Weighted pick from CONFIG.POWERUP_WEIGHTS (the block-chance roll happens in generateMap). */
export function rollPowerUp(rng: () => number): PowerUpKind {
  let r = rng() * POWERUP_TOTAL_WEIGHT;
  for (const [kind, weight] of POWERUP_TABLE) {
    if (r < weight) return kind;
    r -= weight;
  }
  return POWERUP_TABLE[POWERUP_TABLE.length - 1][0];
}

/** Salt that derives the default content key from the layout seed (tests and replays). */
const CONTENT_SALT = 0x5eed_c0de;

/** The content key generateMap uses when none is given: derived from the layout seed. */
export function defaultContentKey(seed: number): Key128 {
  return [0, 1, 2, 3].map((i) => hashSeed(seed, CONTENT_SALT, i)) as unknown as Key128;
}

/**
 * Castle layout comes from `seed`; hidden power-ups come from an INDEPENDENT stream keyed by a
 * 128-bit `contentKey`. Both the layout and every washed castle's contents are public, so a
 * 32-bit content seed could be brute-forced from a handful of reveals and would expose every
 * remaining item; a random 128-bit key cannot. The server passes a fresh crypto-random key per
 * round; the default keeps generateMap fully deterministic per seed for tests and replays.
 */
export function generateMap(mode: Mode, seed: number, contentKey: Key128 = defaultContentKey(seed)): GeneratedMap {
  const { w, h } = CONFIG.MODES[mode];
  const spawns = spawnTilesFor(mode);
  const tiles = layBoulders(w, h);
  scatterCastles(tiles, spawnClearMask(w, h, spawns), mulberry32(seed));
  const hidden = prerollPowerUps(tiles, sfc32(contentKey));
  return { w, h, tiles, hidden, spawns };
}

/** Border ring plus a pillar on every tile whose x and y are both even. */
function layBoulders(w: number, h: number): Uint8Array {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      tiles[idx(w, x, y)] = border || pillar ? Tile.Boulder : Tile.Floor;
    }
  }
  return tiles;
}

/** 1 for every tile within SPAWN_CLEAR tiles (cross shape) of any spawn of the mode. */
function spawnClearMask(w: number, h: number, spawns: { tx: number; ty: number }[]): Uint8Array {
  const clear = new Uint8Array(w * h);
  const reach = CONFIG.SPAWN_CLEAR;
  for (const { tx, ty } of spawns) {
    for (let d = -reach; d <= reach; d++) {
      if (tx + d >= 0 && tx + d < w) clear[idx(w, tx + d, ty)] = 1;
      if (ty + d >= 0 && ty + d < h) clear[idx(w, tx, ty + d)] = 1;
    }
  }
  return clear;
}

/** Row-major: each floor tile outside the clear zones becomes a castle with CASTLE_DENSITY. */
function scatterCastles(tiles: Uint8Array, clear: Uint8Array, rng: () => number): void {
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.Floor || clear[i] === 1) continue;
    if (rng() < CONFIG.CASTLE_DENSITY) tiles[i] = Tile.Castle;
  }
}

/** Row-major: each castle rolls POWERUP_BLOCK_CHANCE, then a weighted power-up kind. */
function prerollPowerUps(tiles: Uint8Array, rng: () => number): Uint8Array {
  const hidden = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.Castle) continue;
    if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) hidden[i] = rollPowerUp(rng);
  }
  return hidden;
}

/** Row-major tile codes as '0' | '1' | '2' characters (round_start.castleGrid). */
export function encodeTiles(tiles: Uint8Array): string {
  let out = '';
  for (let i = 0; i < tiles.length; i++) out += String.fromCharCode(48 + tiles[i]);
  return out;
}

export function decodeTiles(s: string): Uint8Array {
  const tiles = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i) - 48;
    if (code !== Tile.Floor && code !== Tile.Boulder && code !== Tile.Castle) {
      throw new Error(`decodeTiles: invalid tile code '${s[i]}' at ${i}`);
    }
    tiles[i] = code;
  }
  return tiles;
}

/**
 * Tutorial arena, 11x9, hand-designed (x ->, y v; '0' = player slot0, '1' = bot slot1):
 *
 *   x: 0 1 2 3 4 5 6 7 8 9 10
 *   0  # # # # # # # # # # #      #  boulder (border + even/even pillars)
 *   1  # . . . . C . . . . #      C  sandcastle (empty)
 *   2  # . # C # C # . # . #      B  sandcastle hiding an Extra Balloon
 *   3  # . B . . . . . . . #      .  floor
 *   4  # 0 # . # . # C # 1 #
 *   5  # . B . . . . . . . #
 *   6  # . # C # C # . # . #
 *   7  # . . . . C . . . . #
 *   8  # # # # # # # # # # #
 *
 * Lesson route:
 * 1. Move: the player starts at (1,4) inside a pocket (column 1 plus the left ends of rows 1
 *    and 7) sealed by castles, so the passive bot cannot wander in.
 * 2. Balloon + dodge: standing on (1,3) or (1,5) next to the castle at (2,3) / (2,5), a
 *    range-2 balloon washes it; the corner at (2,1) / (2,7) or the far end of column 1 is safe.
 * 3. Power-up: both of those castles (the nearest to the spawn) hide an Extra Balloon.
 * 4. Chain two balloons: row 3 has a castle pair at (3,2) and (5,2) (row 5 mirrors it at
 *    (3,6) and (5,6)). Drop on (3,3), walk to (5,3), drop again: the first splash reaches the
 *    second balloon, the cascade washes both castles, and (8,3) or (7,2) is out of reach.
 * 5. Soak the bot: rows 3 and 5 lead straight to the bot's column 9 (spawn (9,4)).
 * Remaining castles (5,1), (5,7) and (7,4) are empty farming targets.
 */
const TUTORIAL_LAYOUT: readonly string[] = [
  '###########',
  '#....C....#',
  '#.#C#C#.#.#',
  '#.B.......#',
  '#0#.#.#C#1#',
  '#.B.......#',
  '#.#C#C#.#.#',
  '#....C....#',
  '###########',
];

export function buildTutorialMap(): GeneratedMap {
  const h = TUTORIAL_LAYOUT.length;
  const w = TUTORIAL_LAYOUT[0].length;
  const tiles = new Uint8Array(w * h);
  const hidden = new Uint8Array(w * h);
  const spawns: GeneratedMap['spawns'] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = TUTORIAL_LAYOUT[y][x];
      const i = idx(w, x, y);
      if (ch === '#') tiles[i] = Tile.Boulder;
      else if (ch === 'C' || ch === 'B') tiles[i] = Tile.Castle;
      if (ch === 'B') hidden[i] = PowerUp.Balloon;
      if (ch === '0' || ch === '1') spawns.push({ slot: Number(ch), tx: x, ty: y });
    }
  }
  spawns.sort((a, b) => a.slot - b.slot);
  return { w, h, tiles, hidden, spawns };
}
