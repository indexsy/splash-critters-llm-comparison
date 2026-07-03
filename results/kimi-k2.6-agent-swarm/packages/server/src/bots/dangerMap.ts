import type { RoundState, Balloon, GeneratedMap } from '@splash-critters/shared';
import { getTile, inBounds } from '@splash-critters/shared';

export interface DangerMap {
  getDanger(pos: { x: number; y: number }): number;
  getDangerGrid(): number[][];
}

export function computeDangerMap(state: RoundState): DangerMap {
  const { tick, map, balloons } = state;
  const w = map.width;
  const h = map.height;

  const grid: number[][] = Array.from({ length: h }, () => Array(w).fill(Infinity));

  // Mark rising tide (water) tiles as permanently unsafe
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (getTile(map, { x, y }) === 'water') {
        grid[y][x] = tick;
      }
    }
  }

  // Compute each balloon's position at burst time and its base burst tick
  const burstTime = new Map<string, number>();
  const balloonPos = new Map<string, { x: number; y: number }>();

  for (const b of balloons) {
    const pos = b.isKicked ? simulateKickedPosition(b, map) : { x: b.x, y: b.y };
    balloonPos.set(b.id, pos);
    burstTime.set(b.id, tick + b.fuseTicks);
  }

  // Propagate chains: if balloon B is inside A's splash, B bursts at min(B, A).
  // Since chains resolve instantly in the sim, B's burst time becomes A's burst time.
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of balloons) {
      const t = burstTime.get(b.id)!;
      const pos = balloonPos.get(b.id)!;
      const splash = getSplashTiles(pos, b.splashRange, map);

      for (const tile of splash) {
        const other = findBalloonAt(state, tile.x, tile.y, balloonPos);
        if (other && other.id !== b.id) {
          const otherT = burstTime.get(other.id)!;
          if (otherT > t) {
            burstTime.set(other.id, t);
            changed = true;
          }
        }
      }
    }
  }

  // Mark all splash tiles with the earliest burst time.
  // A tile is dangerous from burstTime until burstTime + SPLASH_LINGER_TICKS.
  // For the danger map we store the earliest burst tick; consumers can add linger.
  for (const b of balloons) {
    const t = burstTime.get(b.id)!;
    const pos = balloonPos.get(b.id)!;
    const splash = getSplashTiles(pos, b.splashRange, map);
    for (const tile of splash) {
      if (grid[tile.y][tile.x] > t) {
        grid[tile.y][tile.x] = t;
      }
    }
  }

  return {
    getDanger(pos) {
      if (pos.x < 0 || pos.x >= w || pos.y < 0 || pos.y >= h) return Infinity;
      return grid[pos.y]?.[pos.x] ?? Infinity;
    },
    getDangerGrid() {
      return grid.map((row) => [...row]);
    },
  };
}

/**
 * Simulate where a kicked balloon will be when its fuse reaches zero.
 * Checks static obstacles only (boulders, sandcastles, water) so the danger
 * map is slightly conservative – the balloon may stop earlier if it hits a
 * dynamic obstacle, which is safer for the bot.
 */
function simulateKickedPosition(
  b: Balloon,
  map: GeneratedMap
): { x: number; y: number } {
  if (!b.isKicked || !b.kickDir) return { x: b.x, y: b.y };

  const dx = b.kickDir === 'left' ? -1 : b.kickDir === 'right' ? 1 : 0;
  const dy = b.kickDir === 'up' ? -1 : b.kickDir === 'down' ? 1 : 0;

  let x = b.x;
  let y = b.y;

  for (let i = 0; i < b.fuseTicks; i++) {
    const nx = x + dx;
    const ny = y + dy;

    if (!inBounds(map, { x: nx, y: ny })) break;

    const tile = getTile(map, { x: nx, y: ny });
    if (tile === 'boulder' || tile === 'sandcastle' || tile === 'water') break;

    x = nx;
    y = ny;
  }

  return { x, y };
}

/**
 * Compute all tiles splashed by a balloon at the given center, using the
 * current map state. Mirrors the logic in processBursts.
 */
function getSplashTiles(
  center: { x: number; y: number },
  range: number,
  map: GeneratedMap
): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [{ x: center.x, y: center.y }];

  const dirs: Array<{ dx: number; dy: number }> = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];

  for (const { dx, dy } of dirs) {
    for (let i = 1; i <= range; i++) {
      const tx = center.x + dx * i;
      const ty = center.y + dy * i;

      if (!inBounds(map, { x: tx, y: ty })) break;

      const tile = getTile(map, { x: tx, y: ty });
      if (tile === 'boulder') break;
      if (tile === 'water') break;

      tiles.push({ x: tx, y: ty });

      if (tile === 'sandcastle') break;
    }
  }

  return tiles;
}

/**
 * Find a balloon whose simulated future position matches the given tile.
 */
function findBalloonAt(
  state: RoundState,
  x: number,
  y: number,
  positions: Map<string, { x: number; y: number }>
): Balloon | undefined {
  return state.balloons.find((b) => {
    const pos = positions.get(b.id);
    if (!pos) return false;
    return pos.x === x && pos.y === y;
  });
}
