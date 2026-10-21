import { CONFIG } from './config.js';
import { mulberry32, weightedPick, type Rng } from './rng.js';
import type { Arena, Mode, PowerupId, Theme } from './types.js';

export const POWERUP_ORDER: PowerupId[] = [
  'extra_balloon',
  'big_splash',
  'flippers',
  'boots',
];

/** Border + pillars (even x and even y) are indestructible boulders. */
export function isBoulderTile(x: number, y: number, width: number, height: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

export function idx(width: number, x: number, y: number): number {
  return y * width + x;
}

export interface ArenaOptions {
  width: number;
  height: number;
  seed: number;
  theme: Theme;
  spawns: { x: number; y: number }[];
}

/**
 * Flood fills the free space and checks that every walkable tile can be
 * reached from the spawn points. Sandcastles are never allowed to wall off a
 * pocket of the arena.
 */
function freeSpaceIsConnected(
  castles: Uint8Array,
  width: number,
  height: number,
  spawns: { x: number; y: number }[],
): boolean {
  const blocked = (x: number, y: number) =>
    isBoulderTile(x, y, width, height) || castles[y * width + x] === 1;

  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (!blocked(x, y)) total += 1;
  }
  if (total === 0) return true;

  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  // The flood fill starts at the first spawn: every other spawn has to be
  // reachable from there, otherwise the arena would fall apart in two halves.
  const origin = spawns[0];
  if (origin && !blocked(origin.x, origin.y)) {
    const i = origin.y * width + origin.x;
    seen[i] = 1;
    queue.push(i);
  }
  let visited = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    visited += 1;
    const cur = queue[qi];
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    const neighbours = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (seen[ni] || blocked(nx, ny)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  if (visited !== total) return false;
  // Every spawn point has to live in the same connected region.
  for (const s of spawns) {
    if (s.x < 0 || s.y < 0 || s.x >= width || s.y >= height) continue;
    if (!seen[s.y * width + s.x]) return false;
  }
  return true;
}

/**
 * Builds the arena for a round. Every sandcastle's hidden content is pre-rolled
 * here so the contents are fixed the moment the map spawns and can never be
 * guessed or tampered with by a client.
 */
export function generateArena(opts: ArenaOptions): Arena {
  const { width, height, seed, theme } = opts;
  const rng: Rng = mulberry32(seed >>> 0);
  const castles = new Array(width * height).fill(0);
  const contents: (PowerupId | null)[] = new Array(width * height).fill(null);
  const blocked = new Uint8Array(width * height);

  // Tiles that must stay walkable around each spawn point.
  const clearance = new Set<number>();
  const c = CONFIG.SPAWN_CLEARANCE;
  for (const s of opts.spawns) {
    clearance.add(idx(width, s.x, s.y));
    for (let d = 1; d <= c; d++) {
      clearance.add(idx(width, s.x + d, s.y));
      clearance.add(idx(width, s.x - d, s.y));
      clearance.add(idx(width, s.x, s.y + d));
      clearance.add(idx(width, s.x, s.y - d));
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBoulderTile(x, y, width, height)) blocked[y * width + x] = 1;
    }
  }

  // Lay out the sandcastles. A castle is only kept when the free space stays
  // connected, so the arena never turns into a set of sealed pockets.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(width, x, y);
      if (blocked[i]) continue;
      if (clearance.has(i)) continue;
      if (rng() >= CONFIG.CASTLE_DENSITY) continue;
      blocked[i] = 1;
      if (!freeSpaceIsConnected(blocked, width, height, opts.spawns)) {
        blocked[i] = 0;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      castles[idx(width, x, y)] = blocked[y * width + x] === 1 && !isBoulderTile(x, y, width, height) ? 1 : 0;
    }
  }

  const weights = POWERUP_ORDER.map((k) => CONFIG.POWERUP_WEIGHTS[k]);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(width, x, y);
      if (!castles[i]) continue;
      if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) continue;
      const pick = weightedPick(rng, weights);
      contents[i] = POWERUP_ORDER[pick];
    }
  }

  return { width, height, theme, seed: seed >>> 0, castles, contents };
}

/** Spawn tiles for a mode. Duel uses opposite corners, FFA uses all four. */
export function spawnPointsFor(mode: Mode, width: number, height: number): { x: number; y: number }[] {
  const odd = (v: number) => (v % 2 === 0 ? Math.max(1, v - 1) : v);
  const x1 = odd(1);
  const y1 = odd(1);
  const x2 = odd(width - 2);
  const y2 = odd(height - 2);
  if (mode === 'duel') {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  }
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x1, y: y2 },
    { x: x2, y: y2 },
  ];
}

/** Ring distance of a tile from the arena border (0 = outermost ring). */
export function ringOf(x: number, y: number, width: number, height: number): number {
  return Math.min(x, y, width - 1 - x, height - 1 - y);
}

/**
 * Closed perimeter path (ring 0) used by the revenge ducks. Tiles on the path
 * may overlap boulders — the ducks float above everything.
 */
export function perimeterPath(width: number, height: number): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = [];
  const x0 = 0;
  const x1 = width - 1;
  const y0 = 0;
  const y1 = height - 1;
  for (let x = x0; x <= x1; x++) path.push({ x, y: y0 });
  for (let y = y0 + 1; y <= y1; y++) path.push({ x: x1, y });
  for (let x = x1 - 1; x >= x0; x--) path.push({ x, y: y1 });
  for (let y = y1 - 1; y > y0; y--) path.push({ x: x0, y });
  return path;
}
