import {
  CONFIG,
  balloonAt,
  isFlooded,
  predictBalloonTile,
  splashCells,
  tileRing,
  type SimState,
} from '@splash/shared';

export interface DangerMap {
  time: number[];
}

export function computeDanger(state: SimState): DangerMap {
  const w = state.width;
  const h = state.height;
  const time = new Array<number>(w * h).fill(-1);
  const burst = new Map<number, number>();
  const pos = new Map<number, { x: number; y: number }>();
  for (const b of state.balloons) {
    burst.set(b.id, Math.max(0, b.fuse));
    pos.set(b.id, predictBalloonTile(state, b));
  }
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 12) {
    changed = false;
    for (const b of state.balloons) {
      const t = burst.get(b.id)!;
      const origin = pos.get(b.id)!;
      const cells = splashCells(state, origin.x, origin.y, b.range, b.id);
      for (const c of cells) {
        const other = balloonAt(state, c.x, c.y, b.id);
        if (!other) continue;
        const ot = burst.get(other.id)!;
        if (t < ot) {
          burst.set(other.id, t);
          changed = true;
        }
      }
    }
  }
  for (const b of state.balloons) {
    const t = burst.get(b.id)!;
    const origin = pos.get(b.id)!;
    for (const c of splashCells(state, origin.x, origin.y, b.range, b.id)) {
      const i = c.y * w + c.x;
      if (time[i]! < 0 || t < time[i]!) time[i] = t;
    }
  }
  for (const s of state.splashes) time[s.y * w + s.x] = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isFlooded(state, x, y)) time[y * w + x] = 0;
    }
  }
  let until = state.tideStart - state.tick;
  const nextLevel = state.tick >= state.tideStart ? state.tideLevel + 1 : 1;
  if (state.tick >= state.tideStart) {
    const into = (state.tick - state.tideStart) % state.tideInterval;
    until = state.tideInterval - into;
  }
  if (until >= 0 && until < 90) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tileRing(x, y, w, h) !== nextLevel) continue;
        const i = y * w + x;
        if (time[i]! < 0 || until < time[i]!) time[i] = until;
      }
    }
  }
  return { time };
}

export function perceive(danger: DangerMap, difficulty: 'easy' | 'medium' | 'hard', rng: () => number): DangerMap {
  if (difficulty !== 'easy') return danger;
  const time = danger.time.slice();
  for (let i = 0; i < time.length; i++) {
    const t = time[i]!;
    if (t > 22 && rng() < CONFIG.BOT_ERROR.easy) time[i] = -1;
  }
  return { time };
}
