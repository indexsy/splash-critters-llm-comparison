import {
  CONFIG,
  dirVec,
  inBounds,
  tileIndex,
  type BalloonState,
  type Dir,
  type RoundState,
  type TileKind,
} from "@splash/shared";

export type DangerGrid = number[];

const DIRS: Dir[] = ["up", "down", "left", "right"];
const SAFE = 1e9;

function tile(state: RoundState, x: number, y: number): TileKind {
  if (!inBounds(x, y, state.arena.width, state.arena.height)) return "boulder";
  return state.arena.tiles[tileIndex(x, y, state.arena.width)]!;
}

export function computeDangerMap(state: RoundState): DangerGrid {
  const n = state.arena.width * state.arena.height;
  const danger = new Array<number>(n).fill(SAFE);

  const { width, height } = state.arena;
  if (state.tideRing > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ring = Math.min(x, y, width - 1 - x, height - 1 - y);
        if (ring <= state.tideRing) danger[tileIndex(x, y, width)] = 0;
      }
    }
  }

  for (const s of state.splashes) {
    const i = tileIndex(s.tx, s.ty, width);
    danger[i] = 0;
  }

  if (!state.balloons.length) return danger;

  const byPos = new Map<string, BalloonState>();
  for (const b of state.balloons) byPos.set(`${b.tx},${b.ty}`, b);

  const effective = new Map<number, number>();
  for (const b of state.balloons) effective.set(b.id, b.fuseLeft);

  const queue = state.balloons.map((b) => b.id);
  const splashOf = (b: BalloonState): { x: number; y: number }[] => {
    const tiles = [{ x: b.tx, y: b.ty }];
    for (const dir of DIRS) {
      const d = dirVec(dir);
      for (let step = 1; step <= b.range; step++) {
        const x = b.tx + d.x * step;
        const y = b.ty + d.y * step;
        const t = tile(state, x, y);
        if (t === "boulder") break;
        tiles.push({ x, y });
        if (t === "castle") break;
      }
    }
    return tiles;
  };

  const splashCache = new Map<number, { x: number; y: number }[]>();
  for (const b of state.balloons) splashCache.set(b.id, splashOf(b));

  let guard = 0;
  while (queue.length && guard++ < 400) {
    const id = queue.shift()!;
    const b = state.balloons.find((x) => x.id === id);
    if (!b) continue;
    const tiles = splashCache.get(id)!;
    const tBurst = effective.get(id)!;
    for (const p of tiles) {
      const other = byPos.get(`${p.x},${p.y}`);
      if (!other || other.id === id) continue;
      const cur = effective.get(other.id)!;
      if (tBurst < cur) {
        effective.set(other.id, tBurst);
        queue.push(other.id);
      }
    }
  }

  for (const b of state.balloons) {
    const tBurst = effective.get(b.id)!;
    const unsafeUntil = tBurst + CONFIG.SPLASH_LINGER_TICKS;
    for (const p of splashCache.get(b.id)!) {
      const i = tileIndex(p.x, p.y, width);
      if (unsafeUntil < danger[i]!) danger[i] = unsafeUntil;
    }
  }

  return danger;
}

export function isUnsafe(danger: DangerGrid, x: number, y: number, width: number, ticksNeeded: number): boolean {
  const v = danger[tileIndex(x, y, width)] ?? SAFE;
  return v < ticksNeeded;
}

export { SAFE };
