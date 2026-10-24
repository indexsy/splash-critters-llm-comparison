import { CONFIG, directionDelta, mapIndex, tileAt, traceSplash, TILE } from "@splash/shared";
import type { BalloonState, GameState } from "@splash/shared";

export const NO_DANGER = 1_000_000;

export interface DangerMap {
  width: number;
  height: number;
  burst: Int32Array;
  tide: Int32Array;
}

function mark(danger: DangerMap, state: GameState, x: number, y: number, range: number, fuse: number, straight: boolean, direction: BalloonState["direction"]): void {
  for (const cell of traceSplash(state.map, x, y, range, straight, direction)) {
    const index = mapIndex(state.map, cell.x, cell.y);
    danger.burst[index] = Math.min(danger.burst[index], Math.max(0, Math.round(fuse)));
  }
}

function blocked(state: GameState, balloon: BalloonState, x: number, y: number): boolean {
  const tile = tileAt(state.map, x, y);
  return tile === TILE.BOULDER || tile === TILE.CASTLE || state.balloons.some((other) => other.id !== balloon.id && Math.round(other.x) === x && Math.round(other.y) === y);
}

export function buildDangerMap(state: GameState): DangerMap {
  const size = state.map.width * state.map.height;
  const danger: DangerMap = {
    width: state.map.width,
    height: state.map.height,
    burst: new Int32Array(size).fill(NO_DANGER),
    tide: new Int32Array(size).fill(NO_DANGER)
  };
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      const ring = Math.min(x, y, state.map.width - 1 - x, state.map.height - 1 - y);
      const index = mapIndex(state.map, x, y);
      if (state.map.flooded[index]) danger.tide[index] = 0;
      else {
        const floodTick = CONFIG.TIDE_START_TICKS + Math.max(0, ring - 1) * CONFIG.TIDE_INTERVAL_TICKS;
        danger.tide[index] = Math.max(0, floodTick - (state.tick - state.roundStartedTick));
      }
    }
  }
  const effectiveFuses = state.balloons.map((balloon) => balloon.fuse);
  let changed = true;
  while (changed) {
    changed = false;
    for (let sourceIndex = 0; sourceIndex < state.balloons.length; sourceIndex += 1) {
      const source = state.balloons[sourceIndex];
      const cells = traceSplash(state.map, Math.round(source.x), Math.round(source.y), source.range, source.straight, source.direction);
      for (let targetIndex = 0; targetIndex < state.balloons.length; targetIndex += 1) {
        if (sourceIndex === targetIndex) continue;
        const target = state.balloons[targetIndex];
        if (!cells.some((cell) => cell.x === Math.round(target.x) && cell.y === Math.round(target.y))) continue;
        const inherited = Math.min(effectiveFuses[targetIndex], effectiveFuses[sourceIndex]);
        if (inherited < effectiveFuses[targetIndex]) {
          effectiveFuses[targetIndex] = inherited;
          changed = true;
        }
      }
    }
  }
  state.balloons.forEach((balloon, index) => {
    const fuse = effectiveFuses[index];
    mark(danger, state, Math.round(balloon.x), Math.round(balloon.y), balloon.range, fuse, balloon.straight, balloon.direction);
    if (!balloon.kickDir) return;
    const delta = directionDelta(balloon.kickDir);
    let x = Math.round(balloon.x);
    let y = Math.round(balloon.y);
    let progress = balloon.kickProgress;
    let elapsed = 0;
    while (elapsed < fuse) {
      const ticks = Math.max(1, Math.ceil((1 - progress) / (CONFIG.KICK_SPEED / CONFIG.TICK_RATE) - 0.00001));
      elapsed += ticks;
      if (elapsed >= fuse) break;
      const nextX = x + delta.x;
      const nextY = y + delta.y;
      if (blocked(state, balloon, nextX, nextY)) break;
      x = nextX;
      y = nextY;
      progress = 0;
      mark(danger, state, x, y, balloon.range, fuse - elapsed, balloon.straight, balloon.direction);
    }
  });
  for (const splash of state.splashes) {
    danger.burst[mapIndex(state.map, splash.x, splash.y)] = 0;
  }
  return danger;
}

export function isSafeAt(danger: DangerMap, index: number, arrivalTicks = 0, lingerTicks = 0): boolean {
  if (arrivalTicks >= danger.tide[index]) return false;
  const burst = danger.burst[index];
  if (burst === NO_DANGER) return true;
  const safeBefore = arrivalTicks + lingerTicks < burst;
  const safeAfter = arrivalTicks > burst + CONFIG.SPLASH_LINGER_TICKS;
  return safeBefore || safeAfter;
}
