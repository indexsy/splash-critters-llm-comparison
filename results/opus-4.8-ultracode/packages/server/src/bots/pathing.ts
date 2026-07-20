/**
 * Grid pathfinding helpers for bots. Boulders, sandcastles, flooded tiles and
 * balloons are obstacles; movement is 4-directional.
 */

import { Tile, idx, inBounds, type Dir, type GameState } from '@splash/shared';

export interface Tile2 {
  x: number;
  y: number;
}

const STEPS: { dir: Dir; dx: number; dy: number }[] = [
  { dir: 'up', dx: 0, dy: -1 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'left', dx: -1, dy: 0 },
  { dir: 'right', dx: 1, dy: 0 },
];

export function walkableForBot(state: GameState, x: number, y: number): boolean {
  if (!inBounds(x, y, state.width, state.height)) return false;
  if (state.grid[idx(x, y, state.width)] !== Tile.Empty) return false;
  for (const b of state.balloons) {
    if (Math.round(b.x) === x && Math.round(b.y) === y) return false;
  }
  return true;
}

export function dirBetween(from: Tile2, to: Tile2): Dir | null {
  if (to.x > from.x) return 'right';
  if (to.x < from.x) return 'left';
  if (to.y > from.y) return 'down';
  if (to.y < from.y) return 'up';
  return null;
}

export interface BfsResult {
  path: Tile2[]; // tiles from (but excluding) start up to and including the goal
  goal: Tile2;
  dist: number;
}

/**
 * BFS from start to the nearest tile where goalTest is true.
 * goalTest receives the tile and its distance in tiles from start.
 * The start tile itself is walkable by definition (the bot is standing there).
 */
export function bfs(
  state: GameState,
  start: Tile2,
  goalTest: (x: number, y: number, dist: number) => boolean,
  opts: { maxDist?: number; blocked?: (x: number, y: number) => boolean } = {},
): BfsResult | null {
  const w = state.width;
  const maxDist = opts.maxDist ?? 64;
  const startI = idx(start.x, start.y, w);
  const dist = new Map<number, number>([[startI, 0]]);
  const parent = new Map<number, number>();
  const queue: Tile2[] = [start];
  let qi = 0;

  while (qi < queue.length) {
    const cur = queue[qi++];
    const curI = idx(cur.x, cur.y, w);
    const d = dist.get(curI)!;
    if (d > 0 && goalTest(cur.x, cur.y, d)) {
      return { path: reconstruct(parent, startI, curI, w), goal: cur, dist: d };
    }
    if (d >= maxDist) continue;
    for (const s of STEPS) {
      const nx = cur.x + s.dx;
      const ny = cur.y + s.dy;
      if (!walkableForBot(state, nx, ny)) continue;
      if (opts.blocked && opts.blocked(nx, ny)) continue;
      const ni = idx(nx, ny, w);
      if (dist.has(ni)) continue;
      dist.set(ni, d + 1);
      parent.set(ni, curI);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

function reconstruct(parent: Map<number, number>, startI: number, goalI: number, w: number): Tile2[] {
  const path: Tile2[] = [];
  let cur = goalI;
  while (cur !== startI) {
    path.push({ x: cur % w, y: Math.floor(cur / w) });
    const p = parent.get(cur);
    if (p === undefined) break;
    cur = p;
  }
  path.reverse();
  return path;
}

/** Manhattan distance. */
export function manhattan(a: Tile2, b: Tile2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
