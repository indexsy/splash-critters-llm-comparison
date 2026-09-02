import { CONFIG } from '@splash/shared';
import type { GameState } from '@splash/shared';

// Danger map: for each tile, earliest tick when splash will cover it.
// Recomputed every tick. Propagates chains (balloon B inside A's splash inherits min(B,A)).
// Tide tiles are permanently unsafe (Infinity handled as large number).
export interface DangerMap {
  w: number;
  h: number;
  dangerAt: number[][]; // ticks until burst; Infinity = safe
  flooded: boolean[][];
}

function splashTilesFor(w: number, h: number, tiles: number[][], tx: number, ty: number, range: number): { x: number; y: number }[] {
  const out = [{ x: tx, y: ty }];
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    for (let i = 1; i <= range; i++) {
      const x = tx + dx * i;
      const y = ty + dy * i;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (tiles[y][x] === 1) break; // boulder
      out.push({ x, y });
      if (tiles[y][x] === 2) break; // castle stops
    }
  }
  return out;
}

export function computeDanger(s: GameState): DangerMap {
  const { width: w, height: h } = s;
  const dangerAt: number[][] = Array.from({ length: h }, () => Array(w).fill(Infinity));
  const flooded: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));
  const r = s.tideRing;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (r > 0 && (x < r || y < r || x >= w - r || y >= h - r)) flooded[y][x] = true;
    }
  }
  // fuse per balloon, with chain propagation: iterate until fixpoint (bounded 8 iters)
  const fuse = new Map<number, number>();
  for (const b of s.balloons) fuse.set(b.id, b.fuse);
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (const a of s.balloons) {
      const tiles = splashTilesFor(w, h, s.tiles, a.tx, a.ty, a.range);
      for (const t of tiles) {
        for (const b of s.balloons) {
          if (b.id === a.id) continue;
          if (b.tx === t.x && b.ty === t.y) {
            const fa = fuse.get(a.id)!;
            const fb = fuse.get(b.id)!;
            if (fb > fa) {
              fuse.set(b.id, fa);
              changed = true;
            }
          }
        }
      }
    }
    if (!changed) break;
  }
  for (const b of s.balloons) {
    const f = fuse.get(b.id)!;
    const tiles = splashTilesFor(w, h, s.tiles, b.tx, b.ty, b.range);
    for (const t of tiles) {
      const cur = dangerAt[t.y][t.x];
      const v = f;
      if (v < cur) dangerAt[t.y][t.x] = v;
    }
  }
  // active splashes are dangerous now
  for (const sp of s.splashes) {
    dangerAt[sp.ty][sp.tx] = Math.min(dangerAt[sp.ty][sp.tx], 0);
  }
  return { w, h, dangerAt, flooded };
}

export function isUnsafe(d: DangerMap, tx: number, ty: number, escapeTicks = 8): boolean {
  if (tx < 0 || ty < 0 || tx >= d.w || ty >= d.h) return true;
  if (d.flooded[ty][tx]) return true;
  const v = d.dangerAt[ty][tx];
  if (!isFinite(v)) return false;
  // unsafe if can't exit before burst + splash duration
  return v <= escapeTicks + CONFIG.SPLASH_TICKS;
}
