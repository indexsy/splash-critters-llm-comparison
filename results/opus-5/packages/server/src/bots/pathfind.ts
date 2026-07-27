/**
 * Time-aware BFS over the arena.
 *
 * A plain shortest path is not enough: a route is only usable if the bot is not
 * standing on a tile while it is being splashed. So every tile records the tick
 * the bot would arrive there, and a step is refused when the destination is
 * lethal during the crossing.
 */

import { CARDINALS, DIR_VECTORS, Dir, idx } from '@splash/shared';
import type { DirValue, SolidFn } from '@splash/shared';
import type { DangerMap } from './dangerMap.js';

export interface WalkOptions {
  width: number;
  height: number;
  /** Exact tile-space position, so the first step costs what it really costs. */
  startX: number;
  startY: number;
  /** Absolute tick the walk begins at. */
  startTick: number;
  /** Ticks the bot needs to cross one tile at its current speed. */
  ticksPerTile: number;
  solid: SolidFn;
  danger: DangerMap;
}

export interface Reachability {
  width: number;
  startIndex: number;
  /** Previous tile on the shortest route, -1 when there is none. */
  parent: Int32Array;
  /** Absolute arrival tick, Infinity when the tile cannot be reached safely. */
  arrive: Float64Array;
  /** Reachable tiles, nearest first. */
  visited: number[];
}

export function tileX(width: number, i: number): number {
  return i % width;
}

export function tileY(width: number, i: number): number {
  return (i - (i % width)) / width;
}

export function manhattan(width: number, a: number, b: number): number {
  return Math.abs(tileX(width, a) - tileX(width, b)) + Math.abs(tileY(width, a) - tileY(width, b));
}

/**
 * Would standing on this tile be lethal at any point across [from, to]?
 *
 * Exact, not sampled. A splash window is barely a dozen ticks wide while these
 * questions are asked over hundreds, so probing at intervals steps straight
 * over the very burst the bot is asking about.
 */
export function dangerousDuring(
  danger: DangerMap,
  tx: number,
  ty: number,
  from: number,
  to: number,
): boolean {
  if (danger.isDangerous(tx, ty, from)) return true;
  if (to <= from) return false;
  // Water never recedes, so anything that starts inside the span is still on
  // at the end of it; that leaves only a splash that opens and shuts between.
  if (danger.isDangerous(tx, ty, to)) return true;
  const burst = danger.burstTick[idx(danger.width, tx, ty)];
  return burst >= from && burst <= to;
}

/** Can the bot park on this tile for `ticks` after arriving? */
export function safeToLinger(
  danger: DangerMap,
  tx: number,
  ty: number,
  fromTick: number,
  ticks: number,
): boolean {
  return !dangerousDuring(danger, tx, ty, fromTick, fromTick + Math.max(0, ticks));
}

/**
 * Ticks until the critter's centre crosses out of the tile it is in. Standing
 * one pixel from the boundary is not the same as standing in the middle, and
 * the difference decides whether an escape beats a fuse.
 */
export function exitTicks(x: number, y: number, dir: DirValue, ticksPerTile: number): number {
  switch (dir) {
    case Dir.RIGHT:
      return (Math.floor(x) + 1 - x) * ticksPerTile;
    case Dir.LEFT:
      return (x - Math.floor(x)) * ticksPerTile;
    case Dir.DOWN:
      return (Math.floor(y) + 1 - y) * ticksPerTile;
    case Dir.UP:
      return (y - Math.floor(y)) * ticksPerTile;
    default:
      return 0;
  }
}

export function exploreReachable(opts: WalkOptions): Reachability {
  const { width, height, solid, danger, ticksPerTile } = opts;
  const parent = new Int32Array(width * height).fill(-1);
  const arrive = new Float64Array(width * height).fill(Infinity);
  const startX = Math.floor(opts.startX);
  const startY = Math.floor(opts.startY);
  const startIndex = idx(width, startX, startY);
  const visited: number[] = [startIndex];
  arrive[startIndex] = opts.startTick;

  for (let head = 0; head < visited.length; head++) {
    const cur = visited[head];
    const cx = tileX(width, cur);
    const cy = tileY(width, cur);
    const first = cur === startIndex;
    for (const dir of CARDINALS) {
      const [dx, dy] = DIR_VECTORS[dir];
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      const next = idx(width, tx, ty);
      if (arrive[next] !== Infinity) continue;
      if (solid(tx, ty)) continue;
      const eta =
        arrive[cur] + (first ? exitTicks(opts.startX, opts.startY, dir, ticksPerTile) : ticksPerTile);
      // Getting out of the tile we are on has to happen before it is splashed.
      if (first && dangerousDuring(danger, cx, cy, arrive[cur], eta)) continue;
      // A tile is occupied from stepping in until stepping back out, so a route
      // through it needs the whole crossing clear, not just the moment we land.
      if (dangerousDuring(danger, tx, ty, arrive[cur], eta + ticksPerTile)) continue;
      arrive[next] = eta;
      parent[next] = cur;
      visited.push(next);
    }
  }

  return { width, startIndex, parent, arrive, visited };
}

/** Tiles to walk through to reach `target`, excluding the tile we start on. */
export function pathTo(reach: Reachability, target: number): number[] {
  if (target === reach.startIndex) return [];
  if (reach.arrive[target] === Infinity) return [];
  const path: number[] = [];
  let cur = target;
  while (cur !== reach.startIndex && cur >= 0) {
    path.push(cur);
    cur = reach.parent[cur];
  }
  path.reverse();
  return path;
}

/** Direction to walk from one tile to an orthogonally adjacent one. */
export function stepDir(width: number, from: number, to: number): DirValue {
  const fx = tileX(width, from);
  const fy = tileY(width, from);
  const tx = tileX(width, to);
  const ty = tileY(width, to);
  if (tx > fx) return Dir.RIGHT;
  if (tx < fx) return Dir.LEFT;
  if (ty > fy) return Dir.DOWN;
  if (ty < fy) return Dir.UP;
  return Dir.NONE;
}
