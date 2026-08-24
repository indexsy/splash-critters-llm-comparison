import { CONFIG } from "@sc/shared";
import { TILE_BOULDER, TILE_CASTLE } from "@sc/shared";
import type { SimState } from "@sc/shared";

export interface DangerMap {
  /** ticks until tile is hit by a splash; Infinity = safe */
  time: Float64Array;
  /** tiles covered by any current splash (still lethal while lingering) */
  splash: Uint8Array;
}

/**
 * Recompute per-tick. For each live balloon mark all splash tiles with
 * time-to-burst, propagating chains: balloon B inside A's splash inherits
 * min(B, A). Iterates to fixpoint (few balloons → cheap).
 */
export function computeDanger(state: SimState): DangerMap {
  const { w, h } = state.config;
  const n = w * h;
  const time = new Float64Array(n).fill(Infinity);
  const splash = new Uint8Array(n);
  for (const sp of state.splashes) {
    for (const c of sp.cells) splash[c] = 1;
  }

  const markSplash = (bx: number, by: number, range: number, burstAt: number): void => {
    const set = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const t = y * w + x;
      const tile = state.grid[t]!;
      if (tile === TILE_BOULDER) return false;
      time[t] = Math.min(time[t]!, burstAt);
      return true;
    };
    set(bx, by);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let i = 1; i <= range; i++) {
        const x = bx + dx * i;
        const y = by + dy * i;
        if (!set(x, y)) break;
        const t = y * w + x;
        if (state.grid[t] === TILE_CASTLE) break;
      }
    }
  };

  // iterate: chains propagate min fuse
  let changed = true;
  let passes = 0;
  while (changed && passes < 8) {
    changed = false;
    passes++;
    for (const b of state.balloons) {
      const effective = Math.min(b.fuse, time[b.y * w + b.x]!);
      const before = time[b.y * w + b.x]!;
      // temporarily treat own tile as its own time to avoid self-feedback weirdness
      time[b.y * w + b.x] = Infinity;
      markSplash(b.x, b.y, b.range, effective);
      if (time[b.y * w + b.x] === Infinity) time[b.y * w + b.x] = before;
      else time[b.y * w + b.x] = Math.min(before, time[b.y * w + b.x]!);
      if (effective < before) changed = true;
    }
  }

  // rising tide tiles are permanently unsafe
  if (state.tideRing >= 0) {
    for (let t = 0; t < n; t++) {
      if (state.grid[t] === 3) {
        time[t] = 0;
        splash[t] = 1;
      }
    }
  }
  return { time, splash };
}

/** BFS over walkable tiles; returns dist in tiles and predecessor map.
 * A tile may be traversed if the bot can pass through before any splash hits it. */
export function bfsReachable(
  state: SimState,
  sx: number,
  sy: number,
  danger: DangerMap,
  maxSteps: number,
  speed = CONFIG.speedBase,
): { dist: Int32Array; prev: Int32Array } {
  const { w, h } = state.config;
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const start = sy * w + sx;
  dist[start] = 0;
  const queue: number[] = [start];
  const ticksPerTile = CONFIG.tickRate / Math.max(0.5, speed);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (dist[cur]! >= maxSteps) continue;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    const arrivalHere = Math.ceil(dist[cur]! * ticksPerTile);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx2 = cx + dx;
      const ny2 = cy + dy;
      if (nx2 <= 0 || ny2 <= 0 || nx2 >= w - 1 || ny2 >= h - 1) continue;
      const nt = ny2 * w + nx2;
      if (dist[nt] !== -1) continue;
      const tile = state.grid[nt]!;
      if (tile === TILE_BOULDER || tile === TILE_CASTLE || tile === 3 /* flooded */) continue;
      // never path through an ACTIVE splash
      if (danger.splash[nt] === 1) continue;
      // must be clear of this tile's splash before we'd still be standing in it
      if (danger.time[nt] !== Infinity && danger.time[nt]! <= arrivalHere + CONFIG.splashLingerTicks) continue;
      dist[nt] = dist[cur]! + 1;
      prev[nt] = cur;
      queue.push(nt);
    }
  }
  return { dist, prev };
}
