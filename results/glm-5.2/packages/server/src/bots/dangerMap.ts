// dangerMap.ts — per-tile time-to-burst danger, computed every tick (spec §9).
// For each live balloon, mark all splash tiles with time-to-burst; propagating
// chains (balloon B inside A's splash inherits min(B, A)). A tile is unsafe if
// the bot cannot exit before burst + splash linger.

import { BALLOON_FUSE_TICKS, SPLASH_LINGER_TICKS } from "@splash/shared";
import type { Balloon, MatchState } from "@splash/shared";
import { DIR_DX, DIR_DY } from "@splash/shared";

/** Returns a Float32Array (width*height) where a finite value = tick-until-deadly
 *  from now, Infinity = safe. A tile is deadly once a splash reaches it. */
export function computeDangerMap(state: MatchState): Float32Array {
  const { width: w, height: h } = state;
  const danger = new Float32Array(w * h).fill(Infinity);

  const splashTilesFor = (b: Balloon): { x: number; y: number; t: number }[] => {
    const tiles: { x: number; y: number; t: number }[] = [{ x: b.x, y: b.y, t: b.fuse }];
    const mark = (dx: number, dy: number) => {
      for (let d = 1; d <= b.range; d++) {
        const nx = b.x + dx * d;
        const ny = b.y + dy * d;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
        const t = state.tiles[ny * w + nx];
        if (t === 1) break; // boulder blocks
        tiles.push({ x: nx, y: ny, t: b.fuse });
        if (t === 2) break; // castle stops propagation
      }
    };
    mark(0, -1); mark(0, 1); mark(-1, 0); mark(1, 0);
    return tiles;
  };

  // BFS over balloons resolving chain inheritance.
  const seen = new Set<number>();
  const queue: Balloon[] = [];
  for (const b of state.balloons.values()) queue.push(b);

  // Resolve inherited fuse via propagation: a balloon inside another's splash
  // bursts at min(its own fuse, parent's fuse). Iterate to fixpoint.
  let changed = true;
  const balloonFuse = new Map<number, number>();
  for (const b of state.balloons.values()) balloonFuse.set(b.id, b.fuse);
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const a of state.balloons.values()) {
      const tilesA = splashTilesFor({ ...a, fuse: balloonFuse.get(a.id)! });
      for (const [bid, bf] of balloonFuse) {
        if (bid === a.id) continue;
        const c = state.balloons.get(bid)!;
        if (tilesA.some((t) => t.x === c.x && t.y === c.y)) {
          const inh = Math.min(bf, balloonFuse.get(a.id)!);
          if (inh !== bf) {
            balloonFuse.set(bid, inh);
            changed = true;
          }
        }
      }
    }
  }

  // stamp danger using resolved fuses
  for (const b of state.balloons.values()) {
    const fuse = balloonFuse.get(b.id)!;
    const eff = { ...b, fuse };
    const tiles = splashTilesFor(eff);
    for (const t of tiles) {
      const i = t.y * w + t.x;
      // deadly during burst tick through linger
      const window = fuse + SPLASH_LINGER_TICKS;
      if (window < danger[i]) danger[i] = window;
    }
  }

  // Rising tide tiles are permanently unsafe.
  if (state.tideActive && state.tideRing > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const distBorder = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (distBorder < state.tideRing) danger[y * w + x] = 0;
      }
    }
  }

  return danger;
}

/** True if the tile will be unsafe at any point within `withinTicks`, AND the bot
 *  cannot reach a safe tile before the splash lands. Uses BFS over walkable tiles. */
export function isTileSafe(
  state: MatchState,
  danger: Float32Array,
  startX: number,
  startY: number,
  speedTilesPerTick: number,
): boolean {
  const { width: w } = state;
  const dangerAt = (x: number, y: number) => danger[y * w + x];
  // if current tile is safe indefinitely, fine
  if (dangerAt(startX, startY) === Infinity) return true;
  // BFS by tile-hops; each hop costs 1/speed ticks
  const costPerTile = 1 / speedTilesPerTick;
  const visited = new Set<number>([startY * w + startX]);
  const queue: { x: number; y: number; cost: number }[] = [
    { x: startX, y: startY, cost: 0 },
  ];
  while (queue.length) {
    const { x, y, cost } = queue.shift()!;
    const dd = dangerAt(x, y);
    if (dd === Infinity || dd > cost + 0.5) return true; // reachable before deadly window
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d];
      const ny = y + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= state.height) continue;
      const ti = ny * w + nx;
      if (visited.has(ti)) continue;
      const t = state.tiles[ti];
      if (t === 1 || t === 2) continue; // blocked
      visited.add(ti);
      queue.push({ x: nx, y: ny, cost: cost + costPerTile });
    }
  }
  return false;
}
