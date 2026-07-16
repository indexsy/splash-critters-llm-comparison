import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';
import {
  PowerUpKind,
  TILE_BOULDER,
  TILE_CASTLE,
  TILE_FLOOR,
  tileIndex,
} from './types.js';

export interface GeneratedMap {
  w: number;
  h: number;
  tiles: number[];
  castleContents: Map<number, PowerUpKind>;
  spawns: { x: number; y: number }[];
}

export function spawnPoints(w: number, h: number, mode: 'duel' | 'ffa', playerCount: number): { x: number; y: number }[] {
  const corners = [
    { x: 1, y: 1 },
    { x: w - 2, y: h - 2 },
    { x: w - 2, y: 1 },
    { x: 1, y: h - 2 },
  ];
  if (mode === 'duel') return [corners[0]!, corners[1]!];
  return corners.slice(0, Math.max(2, Math.min(4, playerCount)));
}

function rollPowerUp(r: () => number): PowerUpKind | null {
  if (r() >= CONFIG.POWERUP_BLOCK_CHANCE) return null;
  const w = CONFIG.POWERUP_WEIGHTS;
  const roll = r();
  let acc = 0;
  acc += w.balloon;
  if (roll < acc) return 'balloon';
  acc += w.range;
  if (roll < acc) return 'range';
  acc += w.speed;
  if (roll < acc) return 'speed';
  return 'boots';
}

export function generateMap(w: number, h: number, mode: 'duel' | 'ffa', playerCount: number, seed: number): GeneratedMap {
  const r = mulberry32(seed);
  const tiles = new Array<number>(w * h).fill(TILE_FLOOR);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) tiles[tileIndex(w, x, y)] = TILE_BOULDER;
    }
  }

  const spawns = spawnPoints(w, h, mode, playerCount);
  const isSpawnClear = (x: number, y: number): boolean => {
    for (const s of spawns) {
      if (Math.abs(x - s.x) + Math.abs(y - s.y) <= 2) return true;
    }
    return false;
  };

  const castleContents = new Map<number, PowerUpKind>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = tileIndex(w, x, y);
      if (tiles[idx] !== TILE_FLOOR) continue;
      if (isSpawnClear(x, y)) continue;
      if (r() < CONFIG.CASTLE_DENSITY) {
        tiles[idx] = TILE_CASTLE;
        const content = rollPowerUp(r);
        if (content) castleContents.set(idx, content);
      }
    }
  }

  return { w, h, tiles, castleContents, spawns };
}
