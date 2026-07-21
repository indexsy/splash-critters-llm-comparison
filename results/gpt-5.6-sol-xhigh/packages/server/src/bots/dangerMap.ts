import { isFlooded, type Balloon, type GameState } from "@splash/shared";

export type DangerMap = Map<string, number>;

export function dangerKey(x: number, y: number): string {
  return `${x},${y}`;
}

const VECTORS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];

function tileBlocksSplash(state: GameState, x: number, y: number): boolean {
  const tile = state.map.tiles[y]?.[x] ?? 1;
  return tile === 1;
}

function predictSplashTiles(state: GameState, balloon: Balloon): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [{ x: balloon.x, y: balloon.y }];
  for (const v of VECTORS) {
    for (let distance = 1; distance <= balloon.range; distance++) {
      const x = balloon.x + v.x * distance;
      const y = balloon.y + v.y * distance;
      if (tileBlocksSplash(state, x, y)) break;
      result.push({ x, y });
      if (state.map.tiles[y]?.[x] === 2) break;
    }
  }
  return result;
}

export function computeDangerMap(state: GameState): DangerMap {
  const map: DangerMap = new Map();
  const set = (x: number, y: number, tick: number): void => {
    const key = dangerKey(x, y);
    const prev = map.get(key);
    if (prev === undefined || tick < prev) map.set(key, tick);
  };
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (isFlooded(state, x, y)) set(x, y, state.tick);
    }
  }
  for (const splash of state.splashes) set(splash.x, splash.y, state.tick);
  const effectiveBurst = new Map(state.balloons.map((balloon) => [balloon.id, balloon.burstAt]));
  const queue = [...state.balloons].sort((a, b) => a.burstAt - b.burstAt || a.id - b.id);
  while (queue.length > 0) {
    const balloon = queue.shift()!;
    const burstAt = effectiveBurst.get(balloon.id) ?? balloon.burstAt;
    const tiles = predictSplashTiles(state, balloon);
    for (const tile of tiles) {
      set(tile.x, tile.y, burstAt);
      const chained = state.balloons.find((candidate) => candidate.id !== balloon.id && candidate.x === tile.x && candidate.y === tile.y);
      if (!chained || (effectiveBurst.get(chained.id) ?? chained.burstAt) <= burstAt) continue;
      effectiveBurst.set(chained.id, burstAt);
      queue.push(chained);
      queue.sort((a, b) => (effectiveBurst.get(a.id) ?? a.burstAt) - (effectiveBurst.get(b.id) ?? b.burstAt) || a.id - b.id);
    }
  }
  return map;
}

export function isDangerousNow(map: DangerMap, x: number, y: number, currentTick: number): boolean {
  const t = map.get(dangerKey(x, y));
  return t !== undefined && t <= currentTick + 1;
}

export function dangerArrival(map: DangerMap, x: number, y: number): number | undefined {
  return map.get(dangerKey(x, y));
}
