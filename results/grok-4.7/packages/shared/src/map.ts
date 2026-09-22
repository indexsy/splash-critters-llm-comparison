import {
  CARDINALS,
  CONFIG,
  DIRS,
  TILE_BOULDER,
  TILE_CASTLE,
  TILE_EMPTY,
  type Mode,
  type PowerKind,
} from './config.js';
import { mulberry32 } from './rng.js';

export interface Spawn {
  x: number;
  y: number;
}

export interface HiddenPower {
  x: number;
  y: number;
  kind: PowerKind;
}

export interface GeneratedMap {
  width: number;
  height: number;
  tiles: number[];
  powerups: HiddenPower[];
  spawns: Spawn[];
  seed: number;
  lootSalt: number;
}

export function isStaticBoulder(x: number, y: number, w: number, h: number): boolean {
  if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

export function tileRing(x: number, y: number, w: number, h: number): number {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

export function spawnsFor(w: number, h: number, count: number): Spawn[] {
  const corners: Spawn[] = [
    { x: 1, y: 1 },
    { x: w - 2, y: h - 2 },
    { x: w - 2, y: 1 },
    { x: 1, y: h - 2 },
  ];
  return count <= 2 ? [corners[0]!, corners[1]!] : corners;
}

export function generateMap(opts: {
  width: number;
  height: number;
  seed: number;
  players: number;
  castleDensity?: number;
  lootSalt?: number;
}): GeneratedMap {
  const { width: w, height: h, seed } = opts;
  const density = opts.castleDensity ?? CONFIG.CASTLE_DENSITY;
  const lootSalt = opts.lootSalt ?? (seed ^ 0x5bd1e995);
  const rng = mulberry32(seed);
  const lootRng = mulberry32(lootSalt);
  const tiles = new Array<number>(w * h).fill(TILE_EMPTY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isStaticBoulder(x, y, w, h)) tiles[y * w + x] = TILE_BOULDER;
    }
  }
  const spawns = spawnsFor(w, h, opts.players);
  const clear = new Set<string>();
  for (const s of spawns) {
    clear.add(`${s.x},${s.y}`);
    for (const dir of CARDINALS) {
      const d = DIRS[dir];
      for (let i = 1; i <= 2; i++) {
        const x = s.x + d.x * i;
        const y = s.y + d.y * i;
        if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue;
        if (isStaticBoulder(x, y, w, h)) continue;
        clear.add(`${x},${y}`);
      }
    }
  }
  const powerups: HiddenPower[] = [];
  const weights: { kind: PowerKind; w: number }[] = [
    { kind: 'balloon', w: CONFIG.POWERUP_WEIGHTS.balloon },
    { kind: 'splash', w: CONFIG.POWERUP_WEIGHTS.splash },
    { kind: 'flippers', w: CONFIG.POWERUP_WEIGHTS.flippers },
    { kind: 'boots', w: CONFIG.POWERUP_WEIGHTS.boots },
  ];
  const weightSum = weights.reduce((s, e) => s + e.w, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== TILE_EMPTY) continue;
      if (clear.has(`${x},${y}`)) continue;
      if (rng() >= density) continue;
      tiles[y * w + x] = TILE_CASTLE;
      if (lootRng() < CONFIG.POWERUP_BLOCK_CHANCE) {
        let roll = lootRng() * weightSum;
        let kind: PowerKind = 'balloon';
        for (const entry of weights) {
          roll -= entry.w;
          if (roll < 0) {
            kind = entry.kind;
            break;
          }
        }
        powerups.push({ x, y, kind });
      }
    }
  }
  return { width: w, height: h, tiles, powerups, spawns, seed, lootSalt };
}

export function generateForMode(mode: Mode, seed: number, lootSalt?: number): GeneratedMap {
  const size = mode === 'duel'
    ? { width: CONFIG.DUEL_W, height: CONFIG.DUEL_H, players: 2 }
    : { width: CONFIG.FFA_W, height: CONFIG.FFA_H, players: 4 };
  return generateMap({ ...size, seed, lootSalt });
}
