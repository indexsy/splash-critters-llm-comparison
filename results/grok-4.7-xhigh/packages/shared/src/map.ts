import { CONFIG, POWERUP_ORDER, arenaSize, type Mode, type PowerupKind } from './config.js';
import { mulberry32 } from './rng.js';
import { Tile, type TileId } from './types.js';

export interface GeneratedMap {
  width: number;
  height: number;
  tiles: number[];
  hidden: (PowerupKind | null)[];
  spawns: { x: number; y: number }[];
}

export function spawnPoints(mode: Mode, w: number, h: number): { x: number; y: number }[] {
  if (mode === 'duel') return [
    { x: 1, y: 1 },
    { x: w - 2, y: h - 2 },
  ];
  return [
    { x: 1, y: 1 },
    { x: w - 2, y: 1 },
    { x: 1, y: h - 2 },
    { x: w - 2, y: h - 2 },
  ];
}

export function isBoulder(x: number, y: number, w: number, h: number): boolean {
  if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

function rollPowerup(rng: () => number): PowerupKind | null {
  if (rng() >= CONFIG.POWERUP_BLOCK_CHANCE) return null;
  const r = rng();
  let acc = 0;
  for (const kind of POWERUP_ORDER) {
    acc += CONFIG.POWERUP_WEIGHTS[kind];
    if (r < acc) return kind;
  }
  return 'extra_balloon';
}

export function generateMap(opts: { mode: Mode; seed: number; density?: number }): GeneratedMap {
  const { w, h } = arenaSize(opts.mode);
  const rng = mulberry32(opts.seed);
  const density = opts.density ?? CONFIG.CASTLE_DENSITY;
  const tiles: number[] = new Array(w * h).fill(Tile.Empty);
  const hidden: (PowerupKind | null)[] = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBoulder(x, y, w, h)) tiles[y * w + x] = Tile.Boulder;
    }
  }
  const spawns = spawnPoints(opts.mode, w, h);
  const clear = new Set<string>();
  for (const s of spawns) {
    clear.add(`${s.x},${s.y}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let i = 1; i <= CONFIG.SPAWN_CLEAR; i++) {
        const x = s.x + dx * i;
        const y = s.y + dy * i;
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) clear.add(`${x},${y}`);
      }
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] === Tile.Boulder) continue;
      if (clear.has(`${x},${y}`)) continue;
      if (rng() < density) {
        tiles[i] = Tile.Sandcastle;
        hidden[i] = rollPowerup(rng);
      }
    }
  }
  return { width: w, height: h, tiles, hidden, spawns };
}

export function encodeGrid(tiles: number[]): string {
  let s = '';
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as TileId;
    s += t === Tile.Boulder ? '#' : t === Tile.Sandcastle ? 'C' : t === Tile.Flood ? '~' : '.';
  }
  return s;
}

export function decodeGrid(grid: string): number[] {
  const tiles: number[] = new Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    tiles[i] = c === '#' ? Tile.Boulder : c === 'C' ? Tile.Sandcastle : c === '~' ? Tile.Flood : Tile.Empty;
  }
  return tiles;
}
