import { CONFIG, isBoulderTile } from '@splash-critters/shared';
import type { GameState } from '@splash-critters/shared';

export interface DangerMap {
  width: number;
  height: number;
  /** Tick at which a splash hits each tile (Infinity = never). */
  burstAt: Float64Array;
  /** Id of the balloon that is going to hit the tile (-1 = none). */
  source: Int32Array;
  /** Tiles swallowed by the rising tide. */
  flooded: Uint8Array;
}

const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Tiles a balloon will splash. The cross is blocked by boulders and stops at
 * the first sandcastle, exactly like the authoritative simulation.
 */
export function splashCoverage(
  state: GameState,
  x: number,
  y: number,
  range: number,
): number[] {
  const w = state.arena.width;
  const h = state.arena.height;
  const tiles: number[] = [y * w + x];
  for (const [dx, dy] of DIRS) {
    for (let step = 1; step <= range; step++) {
      const tx = x + dx * step;
      const ty = y + dy * step;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) break;
      if (isBoulderTile(tx, ty, w, h)) break;
      const i = ty * w + tx;
      tiles.push(i);
      if (state.arena.castles[i]) break;
    }
  }
  return tiles;
}

/**
 * Recomputes the danger map for the whole arena.
 *
 * Every live balloon marks the tiles its splash will reach. Balloons that sit
 * inside another balloon's splash inherit the earlier burst time, which makes
 * chain reactions visible to the bots.
 */
export function computeDangerMap(state: GameState): DangerMap {
  const w = state.arena.width;
  const h = state.arena.height;
  const n = w * h;
  const burstAt = new Float64Array(n).fill(Infinity);
  const source = new Int32Array(n).fill(-1);
  const flooded = new Uint8Array(n);

  const balloons = state.balloons;
  const coverage: number[][] = [];
  const effective: number[] = [];
  const tileOwner = new Map<number, number>();

  balloons.forEach((b, i) => {
    coverage.push(splashCoverage(state, b.x, b.y, b.range));
    effective.push(b.fuse);
    tileOwner.set(b.y * w + b.x, i);
  });

  // Fixed point: a balloon inside another balloon's splash inherits the
  // earlier burst time, chains included.
  let changed = true;
  let guard = 0;
  while (changed && guard < 64) {
    changed = false;
    guard += 1;
    for (let i = 0; i < coverage.length; i++) {
      for (const tile of coverage[i]) {
        const j = tileOwner.get(tile);
        if (j === undefined || j === i) continue;
        if (effective[j] > effective[i]) {
          effective[j] = effective[i];
          changed = true;
        }
      }
    }
  }

  for (let i = 0; i < balloons.length; i++) {
    const time = effective[i];
    for (const tile of coverage[i]) {
      if (time < burstAt[tile]) {
        burstAt[tile] = time;
        source[tile] = balloons[i].id;
      }
    }
  }

  if (state.tideRing >= 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ring = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (ring <= state.tideRing) flooded[y * w + x] = 1;
      }
    }
  }

  return { width: w, height: h, burstAt, source, flooded };
}

/** Copy of a danger map so a bot can preview the effect of a new balloon. */
export function cloneDangerMap(danger: DangerMap): DangerMap {
  return {
    width: danger.width,
    height: danger.height,
    burstAt: Float64Array.from(danger.burstAt),
    source: Int32Array.from(danger.source),
    flooded: Uint8Array.from(danger.flooded),
  };
}

/**
 * Marks the tiles a freshly placed balloon would splash at `fuse` ticks from
 * now and returns the number of tiles that became dangerous.
 */
export function addBalloonThreat(
  danger: DangerMap,
  state: GameState,
  x: number,
  y: number,
  range: number,
  fuse: number,
): number {
  const tiles = splashCoverage(state, x, y, range);
  let added = 0;
  for (const tile of tiles) {
    if (fuse < danger.burstAt[tile]) {
      danger.burstAt[tile] = fuse;
      // -1 marks the balloon that is about to be placed
      danger.source[tile] = -1;
      added += 1;
    }
  }
  return added;
}

export function dangerDeadline(danger: DangerMap, tile: number): number {
  return danger.burstAt[tile];
}

export const DANGER_MARGIN_TICKS = 4;
export const DANGER_SAFE_HORIZON = CONFIG.SPLASH_LINGER_TICKS;
