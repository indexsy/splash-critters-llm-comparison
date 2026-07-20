/**
 * Danger map — for every tile, the earliest absolute tick a splash will cover it,
 * with chain propagation (a balloon inside another's blast inherits the earlier
 * burst). Rising-tide tiles (current + next ring) are permanently unsafe.
 * Shared foundation for every bot decision.
 */

import {
  CONFIG,
  Tile,
  computeSplash,
  idx,
  type Balloon,
  type GameState,
} from '@splash/shared';

export interface DangerMap {
  width: number;
  height: number;
  /** earliest absolute tick a splash reaches this tile; Infinity = safe */
  dangerAt: number[];
  now: number;
}

/** Chebyshev distance to the nearest edge (matches tide.ts ring logic). */
function ringDistance(x: number, y: number, w: number, h: number): number {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

export function computeDangerMap(state: GameState, extra: Balloon[] = []): DangerMap {
  const w = state.width;
  const h = state.height;
  const now = state.tick;
  const dangerAt = new Array<number>(w * h).fill(Infinity);

  const balloons = extra.length ? state.balloons.concat(extra) : state.balloons;

  // effective burst tick per balloon, with chain relaxation
  const burst = new Map<number, number>();
  for (const b of balloons) burst.set(b.id, b.fuseTick);
  const splashCache = new Map<number, { x: number; y: number }[]>();
  for (const b of balloons) splashCache.set(b.id, computeSplash(state, b).map((c) => ({ x: c.x, y: c.y })));

  // relax: if balloon B sits on balloon A's splash, B bursts no later than A
  for (let iter = 0; iter < balloons.length + 1; iter++) {
    let changed = false;
    for (const a of balloons) {
      const at = burst.get(a.id)!;
      const cells = splashCache.get(a.id)!;
      for (const b of balloons) {
        if (b.id === a.id) continue;
        const bx = Math.round(b.x);
        const by = Math.round(b.y);
        if (cells.some((c) => c.x === bx && c.y === by)) {
          if (at < burst.get(b.id)!) {
            burst.set(b.id, at);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  for (const b of balloons) {
    const bt = burst.get(b.id)!;
    for (const c of splashCache.get(b.id)!) {
      const i = idx(c.x, c.y, w);
      if (bt < dangerAt[i]) dangerAt[i] = bt;
    }
  }

  // active lingering splash cells => dangerous right now
  for (const s of state.splashes) {
    if (s.expiresTick <= now) continue;
    const i = idx(s.x, s.y, w);
    if (now < dangerAt[i]) dangerAt[i] = now;
  }

  // rising tide: flooded tiles now; next ring at its predicted flood tick
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (state.grid[i] === Tile.Flooded) {
        dangerAt[i] = now;
      }
    }
  }
  if (now >= CONFIG.TIDE_START_TICKS - CONFIG.TIDE_RING_INTERVAL_TICKS) {
    const maxLevel = Math.floor(Math.min(w, h) / 2);
    const nextLevel = state.tideLevel + 1;
    if (nextLevel <= maxLevel) {
      const floodTick = CONFIG.TIDE_START_TICKS + (nextLevel - 1) * CONFIG.TIDE_RING_INTERVAL_TICKS;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (ringDistance(x, y, w, h) !== nextLevel) continue;
          const i = idx(x, y, w);
          if (state.grid[i] !== Tile.Boulder && floodTick < dangerAt[i]) dangerAt[i] = floodTick;
        }
      }
    }
  }

  return { width: w, height: h, dangerAt, now };
}

/** Splash currently present on this tile (unsafe to stand on right now). */
export function tileActiveDanger(dm: DangerMap, x: number, y: number): boolean {
  const i = idx(x, y, dm.width);
  const d = dm.dangerAt[i];
  return d <= dm.now && dm.now <= d + CONFIG.SPLASH_LINGER_TICKS;
}

/** Will this tile be splashed within `lead` ticks (i.e. unsafe to linger)? */
export function tileImminentDanger(dm: DangerMap, x: number, y: number, lead: number): boolean {
  const i = idx(x, y, dm.width);
  const d = dm.dangerAt[i];
  if (d === Infinity) return false;
  return d <= dm.now + lead;
}

/** Fully safe to stand on at `atTick` (no splash arrives while you are there). */
export function tileSafeAt(dm: DangerMap, x: number, y: number, atTick: number): boolean {
  const i = idx(x, y, dm.width);
  const d = dm.dangerAt[i];
  if (d === Infinity) return true;
  // unsafe window is [d, d + linger]; safe if you arrive after it clears or well before it (won't linger)
  return atTick > d + CONFIG.SPLASH_LINGER_TICKS;
}
