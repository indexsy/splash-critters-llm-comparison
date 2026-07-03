import type { Balloon, RoundState, Vec2 } from "@splash/shared";
import { CONFIG } from "@splash/shared";
import { isBoulder } from "@splash/shared";

export type DangerMap = {
  width: number;
  height: number;
  danger: (number | null)[][]; // tick when splash arrives, null = safe
};

export function buildDangerMap(state: RoundState, predictTicks = 60): DangerMap {
  const { width, height } = state;
  const danger: (number | null)[][] = Array.from({ length: width }, () => Array(height).fill(null));

  // Flooded tiles are permanently unsafe
  if (state.tideRing >= 0) {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const d = Math.min(x, y, width - 1 - x, height - 1 - y);
        if (d <= state.tideRing) danger[x][y] = state.tick;
      }
    }
  }

  // Balloon bursts (with chain propagation)
  const visited = new Set<string>();
  for (const b of state.balloons) {
    computeBalloonDanger(state, b, danger, visited, predictTicks);
  }

  return { width, height, danger };
}

function computeBalloonDanger(
  state: RoundState,
  balloon: Balloon,
  danger: (number | null)[][],
  visited: Set<string>,
  predictTicks: number
) {
  const key = `${balloon.id}`;
  if (visited.has(key)) return;
  visited.add(key);

  const burstTick = state.tick + balloon.fuseTick;
  if (burstTick > state.tick + predictTicks) return;

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const d of dirs) {
    for (let step = 1; step <= balloon.range; step++) {
      const tx = balloon.tx + d.x * step;
      const ty = balloon.ty + d.y * step;
      if (isBoulder(state.width, state.height, tx, ty)) break;
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) break;
      const existing = danger[tx][ty];
      if (existing === null || burstTick < existing) danger[tx][ty] = burstTick;
      // Chain: if another balloon here, it bursts earlier
      const other = state.balloons.find((b) => b.id !== balloon.id && Math.floor(b.tx) === tx && Math.floor(b.ty) === ty);
      if (other) {
        const otherKey = `${other.id}`;
        if (!visited.has(otherKey)) {
          // inherit earlier burst
          const otherCopy = { ...other, fuseTick: Math.min(other.fuseTick, burstTick - state.tick) };
          computeBalloonDanger(state, otherCopy, danger, visited, predictTicks);
        }
      }
      const castle = state.castles[tx]?.[ty];
      if (castle?.hasCastle) break;
    }
  }

  // Kicked balloon future positions
  if (balloon.sliding) {
    let tx = balloon.tx;
    let ty = balloon.ty;
    let dist = balloon.sliding.distRemaining;
    let tick = state.tick + 3; // next move approx
    while (dist > 0) {
      tx += balloon.sliding.dir.x;
      ty += balloon.sliding.dir.y;
      if (isBoulder(state.width, state.height, tx, ty)) break;
      if (state.castles[tx]?.[ty]?.hasCastle) break;
      if (state.balloons.some((b) => b.id !== balloon.id && b.tx === tx && b.ty === ty)) break;
      // approximate danger at future location with original fuse
      const futureBurst = tick + balloon.fuseTick;
      if (futureBurst <= state.tick + predictTicks) {
        const existing = danger[tx][ty];
        if (existing === null || futureBurst < existing) danger[tx][ty] = futureBurst;
      }
      tick += 3;
      dist--;
    }
  }
}

export function isSafe(state: RoundState, danger: DangerMap, tx: number, ty: number, reactionTicks: number): boolean {
  if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return false;
  const t = danger.danger[tx][ty];
  if (t === null) return true;
  return t > state.tick + reactionTicks + CONFIG.SPLASH_LINGER_TICKS;
}

export function nearestSafeTile(
  state: RoundState,
  danger: DangerMap,
  startTx: number,
  startTy: number,
  reactionTicks: number
): { tx: number; ty: number } | null {
  if (isSafe(state, danger, startTx, startTy, reactionTicks)) return { tx: startTx, ty: startTy };
  const q: { tx: number; ty: number; dist: number }[] = [{ tx: startTx, ty: startTy, dist: 0 }];
  const seen = new Set<string>([`${startTx},${startTy}`]);
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const d of dirs) {
      const nx = cur.tx + d.x;
      const ny = cur.ty + d.y;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isBoulder(state.width, state.height, nx, ny)) continue;
      if (state.castles[nx]?.[ny]?.hasCastle) continue;
      if (isSafe(state, danger, nx, ny, reactionTicks)) return { tx: nx, ty: ny };
      q.push({ tx: nx, ty: ny, dist: cur.dist + 1 });
    }
  }
  return null;
}

export function reachableSafeNeighbors(
  state: RoundState,
  danger: DangerMap,
  tx: number,
  ty: number,
  reactionTicks: number
): { tx: number; ty: number }[] {
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const safe: { tx: number; ty: number }[] = [];
  for (const d of dirs) {
    const nx = tx + d.x;
    const ny = ty + d.y;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
    if (isBoulder(state.width, state.height, nx, ny)) continue;
    if (state.castles[nx]?.[ny]?.hasCastle) continue;
    if (isSafe(state, danger, nx, ny, reactionTicks)) safe.push({ tx: nx, ty: ny });
  }
  return safe;
}

export function directionTo(from: Vec2, to: { tx: number; ty: number }): Vec2 {
  const dx = to.tx + 0.5 - from.x;
  const dy = to.ty + 0.5 - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.1) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

export function directionToTile(from: Vec2, tx: number, ty: number): Vec2 {
  const dx = tx + 0.5 - from.x;
  const dy = ty + 0.5 - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.1) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}
