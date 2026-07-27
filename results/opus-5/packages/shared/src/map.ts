/**
 * Seeded arena generation.
 *
 * Border and even-coordinate pillars are indestructible boulders; a share of
 * the remaining tiles become sandcastles. Every castle's hidden contents are
 * rolled here, at generation time, from the same PRNG stream - so contents are
 * fixed the instant the map exists, are never transmitted before they are
 * revealed, and are perfectly reproducible from the seed.
 */

import { CONFIG } from './config.js';
import { makeRng, weightedPick, type Rng } from './rng.js';
import { Tile, type GameMode } from './types.js';

export interface ArenaSize {
  width: number;
  height: number;
}

export interface GeneratedMap {
  width: number;
  height: number;
  cells: Uint8Array;
  /** 0 = empty castle, otherwise 1-based index into CONFIG.POWERUP_WEIGHTS. */
  castleContents: Uint8Array;
  spawns: Array<{ x: number; y: number }>;
}

export function arenaSize(mode: GameMode): ArenaSize {
  return mode === 'duel'
    ? { width: CONFIG.DUEL_WIDTH, height: CONFIG.DUEL_HEIGHT }
    : { width: CONFIG.FFA_WIDTH, height: CONFIG.FFA_HEIGHT };
}

export function maxPlayersForMode(mode: GameMode): number {
  return mode === 'duel' ? 2 : 4;
}

export function idx(width: number, x: number, y: number): number {
  return y * width + x;
}

/**
 * Spawn corners. Duel uses opposite corners; FFA uses all four. Order is fixed
 * so slot N always spawns in the same corner across a match.
 */
export function spawnPoints(mode: GameMode): Array<{ x: number; y: number }> {
  const { width, height } = arenaSize(mode);
  const left = 1;
  const right = width - 2;
  const top = 1;
  const bottom = height - 2;
  if (mode === 'duel') {
    return [
      { x: left, y: top },
      { x: right, y: bottom },
    ];
  }
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ];
}

function isBoulder(x: number, y: number, width: number, height: number): boolean {
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

/** Tiles kept free of castles so nobody is sealed in at the whistle. */
function spawnClearMask(mode: GameMode, width: number, height: number): Set<number> {
  const clear = new Set<number>();
  const radius = CONFIG.SPAWN_CLEAR_RADIUS;
  for (const spawn of spawnPoints(mode)) {
    clear.add(idx(width, spawn.x, spawn.y));
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as Array<[number, number]>) {
      for (let step = 1; step <= radius; step++) {
        const x = spawn.x + dx * step;
        const y = spawn.y + dy * step;
        if (x < 1 || y < 1 || x > width - 2 || y > height - 2) break;
        if (isBoulder(x, y, width, height)) break;
        clear.add(idx(width, x, y));
      }
    }
  }
  return clear;
}

export function generateMap(mode: GameMode, seed: number): GeneratedMap {
  const { width, height } = arenaSize(mode);
  const cells = new Uint8Array(width * height);
  const castleContents = new Uint8Array(width * height);
  const rng = makeRng(seed);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells[idx(width, x, y)] = isBoulder(x, y, width, height) ? Tile.BOULDER : Tile.EMPTY;
    }
  }

  const clear = spawnClearMask(mode, width, height);

  // Row-major scan keeps the PRNG stream order stable for a given seed.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(width, x, y);
      if (cells[i] !== Tile.EMPTY) continue;
      if (clear.has(i)) continue;
      if (rng.next() < CONFIG.CASTLE_DENSITY) cells[i] = Tile.CASTLE;
    }
  }

  rollCastleContents(cells, castleContents, width, height, rng);

  return { width, height, cells, castleContents, spawns: spawnPoints(mode) };
}

/** Second deterministic pass: what is buried inside each sandcastle. */
function rollCastleContents(
  cells: Uint8Array,
  contents: Uint8Array,
  width: number,
  height: number,
  rng: Rng,
): void {
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(width, x, y);
      if (cells[i] !== Tile.CASTLE) continue;
      if (rng.next() >= CONFIG.POWERUP_BLOCK_CHANCE) continue;
      const drop = weightedPick(rng, CONFIG.POWERUP_WEIGHTS);
      contents[i] = CONFIG.POWERUP_WEIGHTS.indexOf(drop) + 1;
    }
  }
}

/**
 * Rising Tide flood order: outermost interior ring first, spiralling inward,
 * with an absolute tick stamped on every tile so a whole ring takes
 * TIDE_RING_TICKS regardless of how many tiles it holds.
 */
export function buildTideSchedule(
  width: number,
  height: number,
): { order: Int32Array; ticks: Int32Array } {
  const order: number[] = [];
  const ticks: number[] = [];
  const maxRing = Math.floor(Math.min(width, height) / 2);

  // `<=` matters: the final ring can collapse to a single row or column, and
  // skipping it would leave a handful of tiles that never flood, so two players
  // could sit out sudden death forever.
  for (let ring = 1; ring <= maxRing; ring++) {
    const x0 = ring;
    const y0 = ring;
    const x1 = width - 1 - ring;
    const y1 = height - 1 - ring;
    if (x0 > x1 || y0 > y1) break;
    const ringTiles: number[] = [];
    if (y0 === y1) {
      for (let x = x0; x <= x1; x++) ringTiles.push(idx(width, x, y0));
    } else if (x0 === x1) {
      for (let y = y0; y <= y1; y++) ringTiles.push(idx(width, x0, y));
    } else {
      for (let x = x0; x <= x1; x++) ringTiles.push(idx(width, x, y0));
      for (let y = y0 + 1; y <= y1; y++) ringTiles.push(idx(width, x1, y));
      for (let x = x1 - 1; x >= x0; x--) ringTiles.push(idx(width, x, y1));
      for (let y = y1 - 1; y > y0; y--) ringTiles.push(idx(width, x0, y));
    }
    const ringStart = CONFIG.TIDE_START_TICKS + (ring - 1) * CONFIG.TIDE_RING_TICKS;
    for (let k = 0; k < ringTiles.length; k++) {
      order.push(ringTiles[k]);
      ticks.push(ringStart + Math.floor((k * CONFIG.TIDE_RING_TICKS) / ringTiles.length));
    }
  }

  return { order: Int32Array.from(order), ticks: Int32Array.from(ticks) };
}
