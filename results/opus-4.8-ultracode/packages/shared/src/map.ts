/**
 * Deterministic arena generator.
 * Same (seed, mode) => identical grid AND identical hidden power-up contents,
 * so tests, replays and client prediction all agree.
 */

import { CONFIG } from './config';
import { mulberry32, type Rng } from './rng';
import { Tile, idx, inBounds, type MapTheme, type Mode, type PowerUpType } from './types';

export interface GeneratedMap {
  width: number;
  height: number;
  grid: number[];
  castleContents: (PowerUpType | null)[];
  spawns: { x: number; y: number }[]; // indexed by slot
}

/** Spawn tiles per mode: opposite corners (duel) / four corners (ffa). */
export function spawnPoints(mode: Mode, w: number, h: number): { x: number; y: number }[] {
  const tl = { x: 1, y: 1 };
  const tr = { x: w - 2, y: 1 };
  const bl = { x: 1, y: h - 2 };
  const br = { x: w - 2, y: h - 2 };
  if (mode === 'duel') return [tl, br];
  // FFA slot order: TL, TR, BL, BR
  return [tl, tr, bl, br];
}

/** True where an indestructible boulder must sit (border + even/even pillars). */
function isBoulder(x: number, y: number, w: number, h: number): boolean {
  if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

/** Tiles kept permanently clear around each spawn so nobody starts boxed in. */
function spawnClearSet(
  spawns: { x: number; y: number }[],
  w: number,
  h: number,
): Set<number> {
  const clear = new Set<number>();
  const radius = CONFIG.SPAWN_CLEAR_RADIUS;
  for (const s of spawns) {
    clear.add(idx(s.x, s.y, w));
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      for (let step = 1; step <= radius; step++) {
        const nx = s.x + dx * step;
        const ny = s.y + dy * step;
        if (!inBounds(nx, ny, w, h)) break;
        if (isBoulder(nx, ny, w, h)) break; // a pillar caps the corridor
        clear.add(idx(nx, ny, w));
      }
    }
  }
  return clear;
}

function weightedPowerUp(rng: Rng): PowerUpType {
  const w = CONFIG.POWERUP_WEIGHTS;
  const entries = Object.entries(w) as [PowerUpType, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return entries[entries.length - 1][0];
}

export function generateMap(seed: number, mode: Mode): GeneratedMap {
  const arena = CONFIG.ARENA[mode];
  const w = arena.w;
  const h = arena.h;
  const size = w * h;
  const grid = new Array<number>(size).fill(Tile.Empty);
  const castleContents = new Array<PowerUpType | null>(size).fill(null);

  // 1. boulders (border + pillars)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBoulder(x, y, w, h)) grid[idx(x, y, w)] = Tile.Boulder;
    }
  }

  const spawns = spawnPoints(mode, w, h);
  const clear = spawnClearSet(spawns, w, h);
  const rng = mulberry32(seed);

  // 2. sandcastles + pre-rolled hidden power-ups (single deterministic stream)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (grid[i] !== Tile.Empty) continue; // boulder
      if (clear.has(i)) continue; // protected spawn corridor
      if (!rng.chance(CONFIG.CASTLE_DENSITY)) continue;
      grid[i] = Tile.Sandcastle;
      if (rng.chance(CONFIG.POWERUP_BLOCK_CHANCE)) {
        castleContents[i] = weightedPowerUp(rng);
      }
    }
  }

  return { width: w, height: h, grid, castleContents, spawns };
}

/** Pick a concrete theme for a room ('random' resolves via seed). */
export function resolveTheme(theme: MapTheme | 'random', seed: number): MapTheme {
  if (theme !== 'random') return theme;
  const rng = mulberry32(seed ^ 0x7f4a);
  return rng.pick(CONFIG.THEMES);
}
