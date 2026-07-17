import { CONFIG, GameState, computeSplashTiles, ringDepth, tileIndex, tideTiming } from '@splash/shared';

export interface DangerMap {
  burstAt: Float64Array;
  w: number;
  h: number;
}

function slideRestTile(state: GameState, b: { tx: number; ty: number; slideDir: number }): { tx: number; ty: number } {
  if (b.slideDir === 0) return { tx: b.tx, ty: b.ty };
  const v = b.slideDir === 1 ? { x: 0, y: -1 } : b.slideDir === 2 ? { x: 1, y: 0 } : b.slideDir === 3 ? { x: 0, y: 1 } : { x: -1, y: 0 };
  let tx = b.tx;
  let ty = b.ty;
  for (let i = 0; i < Math.max(state.w, state.h); i++) {
    const nx = tx + v.x;
    const ny = ty + v.y;
    const idx = ny * state.w + nx;
    if (nx < 0 || ny < 0 || nx >= state.w || ny >= state.h) break;
    const t = state.tiles[idx]!;
    if (t !== 0) break;
    if (state.balloons.some((o) => !o.flying && o.tx === nx && o.ty === ny)) break;
    tx = nx;
    ty = ny;
  }
  return { tx, ty };
}

export function computeDangerMap(state: GameState): DangerMap {
  const burstAt = new Float64Array(state.w * state.h).fill(Infinity);

  for (const s of state.splashes) {
    for (const t of s.tiles) {
      burstAt[t] = Math.min(burstAt[t]!, state.tick);
    }
  }

  const landed = state.balloons.filter((b) => !b.flying);
  const eff = new Map<number, number>();
  for (const b of landed) eff.set(b.id, b.burstTick);

  for (let iter = 0; iter < landed.length; iter++) {
    let changed = false;
    for (const a of landed) {
      const range = a.range || CONFIG.STATS.RANGE_BASE;
      const tiles = computeSplashTiles(state, a.tx, a.ty, range);
      for (const other of landed) {
        if (other.id === a.id) continue;
        const oIdx = tileIndex(state.w, other.tx, other.ty);
        if (tiles.includes(oIdx)) {
          const ea = eff.get(a.id)!;
          if (ea < eff.get(other.id)!) {
            eff.set(other.id, ea);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  for (const b of landed) {
    const range = b.range || CONFIG.STATS.RANGE_BASE;
    const t = eff.get(b.id)!;
    const origins = [ { tx: b.tx, ty: b.ty } ];
    if (b.slideDir !== 0) {
      const rest = slideRestTile(state, b);
      if (rest.tx !== b.tx || rest.ty !== b.ty) origins.push(rest);
    }
    for (const o of origins) {
      const tiles = computeSplashTiles(state, o.tx, o.ty, range);
      for (const idx of tiles) {
        burstAt[idx] = Math.min(burstAt[idx]!, t);
      }
    }
  }

  if (state.tideRing >= 0) {
    const roundTick = state.tick - state.roundStartTick;
    const tide = tideTiming(state);
    const nextTideTick =
      roundTick < tide.start
        ? state.roundStartTick + tide.start
        : state.tick + (tide.interval - ((roundTick - tide.start) % tide.interval));
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const depth = ringDepth(state, x, y);
        if (depth < state.tideRing) {
          burstAt[tileIndex(state.w, x, y)] = -Infinity;
        } else if (depth === state.tideRing) {
          burstAt[tileIndex(state.w, x, y)] = Math.min(burstAt[tileIndex(state.w, x, y)]!, nextTideTick);
        }
      }
    }
  }

  return { burstAt, w: state.w, h: state.h };
}

export function tileSafeAt(danger: DangerMap, idx: number, tick: number, margin = 0): boolean {
  const b = danger.burstAt[idx]!;
  if (b === -Infinity) return false;
  return tick + margin < b || tick > b + CONFIG.SPLASH_TICKS;
}
