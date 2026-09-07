import {
  CARDINALS,
  CONFIG,
  DIRECTIONS,
  Tile,
  cloneState,
  simulateTick,
  splashTiles,
  tileAt,
  type GameState,
} from "@splash/shared";

export interface DangerWindow {
  start: number;
  end: number;
}
export type DangerMap = DangerWindow[][];
const cache = new WeakMap<
  GameState,
  { tick: number; balloons: number; map: DangerMap }
>();
export function buildDangerMap(state: GameState): DangerMap {
  const saved = cache.get(state);
  if (saved?.tick === state.tick && saved.balloons === state.balloons.length)
    return saved.map;
  const danger: DangerMap = Array.from(
    { length: state.width * state.height },
    () => [],
  );
  const mark = (x: number, y: number, start: number, end: number) => {
    const windows = danger[y * state.width + x];
    if (!windows) return;
    const overlapping = windows.find((w) => w.start <= end && w.end >= start);
    if (overlapping) {
      overlapping.start = Math.min(overlapping.start, start);
      overlapping.end = Math.max(overlapping.end, end);
    } else windows.push({ start, end });
  };
  for (const s of state.splashes) mark(s.x, s.y, 0, s.expiresTick - state.tick);
  if (state.balloons.length) {
    // Forecast with the real sim: earlier castle destruction can open a later splash lane.
    const future = cloneState(state);
    future.hiddenPowerups = {};
    future.events = [];
    const sliding = new Map<number, { x: number; y: number }[]>();
    const original = new Map(state.balloons.map((b) => [b.id, b]));
    for (
      let t = 1;
      t <= CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS && future.balloons.length;
      t++
    ) {
      for (const b of future.balloons)
        if (original.get(b.id)?.slideDir !== "none") {
          const positions = sliding.get(b.id) ?? [];
          if (!positions.some((p) => p.x === b.x && p.y === b.y))
            positions.push({ x: b.x, y: b.y });
          sliding.set(b.id, positions);
        }
      future.roundOver = false;
      simulateTick(future, {});
      for (const s of future.splashes)
        if (s.expiresTick === future.tick + CONFIG.SPLASH_TICKS)
          mark(s.x, s.y, t, t + CONFIG.SPLASH_TICKS);
      for (const e of future.events)
        if (e.type === "balloon_burst") {
          const b = original.get(e.balloonId)!;
          // Moving players may stop a kicked balloon earlier than this stationary forecast.
          for (const position of sliding.get(e.balloonId) ?? [])
            for (const p of splashTiles(state, position.x, position.y, b.range))
              mark(p.x, p.y, t, t + CONFIG.SPLASH_TICKS);
        }
    }
  }
  for (let y = 0; y < state.height; y++)
    for (let x = 0; x < state.width; x++) {
      const ring = Math.min(x, y, state.width - x - 1, state.height - y - 1);
      const floodAt =
        CONFIG.TIDE_START_TICKS +
        Math.max(0, ring - 1) * CONFIG.TIDE_INTERVAL_TICKS -
        state.tick;
      mark(
        x,
        y,
        state.tiles[y * state.width + x] === Tile.Flood ? 0 : floodAt,
        Infinity,
      );
    }
  cache.set(state, {
    tick: state.tick,
    balloons: state.balloons.length,
    map: danger,
  });
  return danger;
}
export function safeAt(
  danger: DangerMap,
  index: number,
  arrival: number,
  duration = 10,
): boolean {
  return (
    !!danger[index] &&
    !danger[index].some(
      (w) => w.start <= arrival + duration && w.end >= arrival,
    )
  );
}
export function escapePath(
  state: GameState,
  playerId: string,
  danger: DangerMap,
  horizon = CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS,
): number[] | null {
  const p = state.players.find((p) => p.id === playerId)!;
  const start = Math.floor(p.y) * state.width + Math.floor(p.x);
  const stepTicks = Math.ceil(CONFIG.TICK_RATE / p.speed);
  const queue: { index: number; path: number[] }[] = [
    { index: start, path: [] },
  ];
  const visited = new Set([start]);
  for (let q = 0; q < queue.length; q++) {
    const node = queue[q];
    const arrival = node.path.length * stepTicks;
    if (safeAt(danger, node.index, arrival, Math.max(12, horizon - arrival)))
      return node.path;
    for (const dir of CARDINALS) {
      const d = DIRECTIONS[dir];
      const x = (node.index % state.width) + d.x;
      const y = Math.floor(node.index / state.width) + d.y;
      const index = y * state.width + x;
      if (
        visited.has(index) ||
        tileAt(state, x, y) !== Tile.Floor ||
        state.balloons.some((b) => b.x === x && b.y === y)
      )
        continue;
      if (
        !safeAt(
          danger,
          index,
          Math.max(0, arrival + stepTicks - 5),
          stepTicks + 8,
        )
      )
        continue;
      if (
        node.path.length &&
        !safeAt(danger, node.index, arrival, stepTicks + 2)
      )
        continue;
      visited.add(index);
      queue.push({ index, path: [...node.path, index] });
    }
  }
  return null;
}
