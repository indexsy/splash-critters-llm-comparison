import { CONFIG, type PowerupKind } from './config.js';
import { mulberry32, pickWeighted } from './rng.js';
import { TILE_BOULDER, TILE_CASTLE, TILE_EMPTY } from './types.js';

export interface GeneratedMap {
  width: number;
  height: number;
  tiles: number[][];
  contents: (PowerupKind | null)[][];
  spawns: { x: number; y: number }[];
}

function isPillar(x: number, y: number): boolean {
  return x % 2 === 0 && y % 2 === 0;
}

function spawnCells(w: number, h: number, mode: 'duel' | 'ffa'): { x: number; y: number }[] {
  if (mode === 'duel') {
    return [
      { x: 1, y: 1 },
      { x: w - 2, y: h - 2 },
    ];
  }
  return [
    { x: 1, y: 1 },
    { x: w - 2, y: 1 },
    { x: 1, y: h - 2 },
    { x: w - 2, y: h - 2 },
  ];
}

function clearZone(spawns: { x: number; y: number }[]): Set<string> {
  const s = new Set<string>();
  for (const sp of spawns) {
    const cells: [number, number][] = [
      [sp.x, sp.y],
      [sp.x + 1, sp.y],
      [sp.x - 1, sp.y],
      [sp.x, sp.y + 1],
      [sp.x, sp.y - 1],
    ];
    // For corner spawns only keep in-bounds directions; the generic set is fine.
    for (const [x, y] of cells) s.add(`${x},${y}`);
  }
  return s;
}

export function generateMap(mode: 'duel' | 'ffa', seed: number): GeneratedMap {
  const width = mode === 'duel' ? CONFIG.DUEL_W : CONFIG.FFA_W;
  const height = mode === 'duel' ? CONFIG.DUEL_H : CONFIG.FFA_H;
  const rng = mulberry32(seed);
  const tiles: number[][] = [];
  const contents: (PowerupKind | null)[][] = [];
  const spawns = spawnCells(width, height, mode);
  const clear = clearZone(spawns);
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    const crow: (PowerupKind | null)[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border || isPillar(x, y)) {
        row.push(TILE_BOULDER);
        crow.push(null);
        continue;
      }
      if (clear.has(`${x},${y}`)) {
        row.push(TILE_EMPTY);
        crow.push(null);
        continue;
      }
      if (rng() < CONFIG.CASTLE_DENSITY) {
        row.push(TILE_CASTLE);
        if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) {
          crow.push(pickWeighted(rng, CONFIG.POWERUP_WEIGHTS as Record<string, number>) as PowerupKind);
        } else crow.push(null);
      } else {
        row.push(TILE_EMPTY);
        crow.push(null);
      }
    }
    tiles.push(row);
    contents.push(crow);
  }
  return { width, height, tiles, contents, spawns };
}
