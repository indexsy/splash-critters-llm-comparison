import {
  CONFIG,
  DIR_DELTA,
  DIRS,
  idx,
  inBounds,
  type Balloon,
  type Dir,
  type GameState,
} from '@splash/shared';
import { TILE_BOULDER, TILE_CASTLE } from '@splash/shared';

/** time-to-danger in ticks; Infinity = safe */
export type DangerMap = Float64Array;

function tileType(state: GameState, x: number, y: number): number {
  if (!inBounds(x, y, state.width, state.height)) return TILE_BOULDER;
  return state.grid[idx(x, y, state.width)]!;
}

/** Compute splash tiles for a balloon (same rules as sim) */
export function splashTilesFor(
  state: GameState,
  bx: number,
  by: number,
  range: number,
): Array<{ x: number; y: number }> {
  const tiles = [{ x: bx, y: by }];
  for (const dir of DIRS) {
    const { dx, dy } = DIR_DELTA[dir];
    for (let r = 1; r <= range; r++) {
      const nx = bx + dx * r;
      const ny = by + dy * r;
      if (!inBounds(nx, ny, state.width, state.height)) break;
      const t = tileType(state, nx, ny);
      if (t === TILE_BOULDER) break;
      tiles.push({ x: nx, y: ny });
      if (t === TILE_CASTLE) break;
    }
  }
  return tiles;
}

/**
 * For each live balloon (incl. sliding), mark splash tiles with time-to-burst.
 * Chains: balloon B inside A's splash inherits min(B, A) as effective burst time.
 */
export function buildDangerMap(state: GameState): DangerMap {
  const size = state.width * state.height;
  const danger = new Float64Array(size);
  danger.fill(Infinity);

  // Effective burst tick for each balloon (after chain propagation)
  const balloons = state.balloons.slice();
  const burstAt = new Map<number, number>();
  for (const b of balloons) {
    burstAt.set(b.id, b.placeTick + b.fuseTicks);
  }

  // Propagate chains: if B is in A's splash and A bursts first, B bursts at A's time
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const a of balloons) {
      const aTime = burstAt.get(a.id)!;
      const tiles = splashTilesFor(state, a.x, a.y, a.splashRange);
      for (const t of tiles) {
        for (const b of balloons) {
          if (b.id === a.id) continue;
          if (b.x === t.x && b.y === t.y) {
            const bt = burstAt.get(b.id)!;
            if (aTime < bt) {
              burstAt.set(b.id, aTime);
              changed = true;
            }
          }
        }
      }
    }
  }

  for (const b of balloons) {
    const tBurst = burstAt.get(b.id)!;
    const timeToBurst = Math.max(0, tBurst - state.tick);
    const tiles = splashTilesFor(state, b.x, b.y, b.splashRange);
    for (const t of tiles) {
      const i = idx(t.x, t.y, state.width);
      // Unsafe if bot can't exit before burst + splash linger — store time until danger hits
      if (timeToBurst < danger[i]!) {
        danger[i] = timeToBurst;
      }
    }
  }

  // Tide: permanently unsafe
  if (state.tideRing > 0) {
    const r = state.tideRing;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (x < r || y < r || x >= state.width - r || y >= state.height - r) {
          danger[idx(x, y, state.width)] = 0;
        }
      }
    }
  }

  return danger;
}

export function isTileDangerous(danger: DangerMap, x: number, y: number, width: number, escapeTicks: number): boolean {
  if (!inBounds(x, y, width, 999)) return true;
  const t = danger[idx(x, y, width)]!;
  // Dangerous if splash arrives before we can leave (escapeTicks) + need buffer for splash linger
  return t <= escapeTicks + 2;
}

export function tileWalkable(state: GameState, x: number, y: number, ignoreBalloons = false): boolean {
  if (!inBounds(x, y, state.width, state.height)) return false;
  const t = tileType(state, x, y);
  if (t === TILE_BOULDER || t === TILE_CASTLE) return false;
  if (!ignoreBalloons && state.balloons.some((b) => b.x === x && b.y === y)) return false;
  return true;
}

export type BfsNode = { x: number; y: number; dist: number; firstDir: Dir };

export function bfs(
  state: GameState,
  sx: number,
  sy: number,
  goal: (x: number, y: number) => boolean,
  maxDist = 40,
  danger?: DangerMap,
  avoidDanger = true,
): BfsNode | null {
  const startKey = sy * state.width + sx;
  const visited = new Set<number>([startKey]);
  const q: BfsNode[] = [{ x: sx, y: sy, dist: 0, firstDir: 'none' }];

  if (goal(sx, sy)) return q[0]!;

  let head = 0;
  while (head < q.length) {
    const cur = q[head++]!;
    if (cur.dist >= maxDist) continue;
    for (const dir of DIRS) {
      const { dx, dy } = DIR_DELTA[dir];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = ny * state.width + nx;
      if (visited.has(key)) continue;
      if (!tileWalkable(state, nx, ny)) continue;
      if (avoidDanger && danger) {
        const escape = Math.ceil(CONFIG.TICK_RATE / Math.max(1, 4)); // rough tiles to exit
        if (isTileDangerous(danger, nx, ny, state.width, escape + cur.dist * 4)) continue;
      }
      visited.add(key);
      const firstDir = cur.firstDir === 'none' ? dir : cur.firstDir;
      const node: BfsNode = { x: nx, y: ny, dist: cur.dist + 1, firstDir };
      if (goal(nx, ny)) return node;
      q.push(node);
    }
  }
  return null;
}

/** Simulate if placing a balloon at (x,y) leaves a reachable safe tile */
export function canEscapeAfterPlace(
  state: GameState,
  px: number,
  py: number,
  range: number,
  danger: DangerMap,
): boolean {
  // Hypothetical splash from own balloon
  const tiles = splashTilesFor(state, px, py, range);
  const fuse = CONFIG.FUSE_TICKS;
  // Need path to a tile not in splash and not otherwise dangerous before fuse ends
  const splashSet = new Set(tiles.map((t) => t.y * state.width + t.x));
  const result = bfs(
    state,
    px,
    py,
    (x, y) => {
      const key = y * state.width + x;
      if (splashSet.has(key)) return false;
      const d = danger[key]!;
      return d > fuse;
    },
    20,
    danger,
    false,
  );
  return result !== null && result.dist * 4 < fuse; // ~4 ticks per tile at base speed
}
