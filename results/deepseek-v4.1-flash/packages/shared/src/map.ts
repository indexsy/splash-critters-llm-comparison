import { ARENA_THEMES, CONFIG } from "./config.js";
import { mulberry32, type Rng } from "./rng.js";
import type { Arena, ArenaTheme, GameMode, PowerupKind, Vec } from "./types.js";

const CARDINALS: Vec[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

function blankGrid<T>(w: number, h: number, value: T): T[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => value));
}

export function spawnTilesForMode(mode: GameMode, w: number, h: number): Vec[] {
  if (mode === "duel") {
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

function inBounds(arena: Pick<Arena, "w" | "h">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < arena.w && y < arena.h;
}

function carvePath(
  boulders: boolean[][],
  castles: number[][],
  from: Vec,
  to: Vec,
  w: number,
  h: number,
): void {
  const visited = blankGrid(w, h, false);
  const parent = new Map<number, number>();
  const key = (x: number, y: number) => y * w + x;
  const queue: Vec[] = [from];
  visited[from.y]![from.x] = true;
  let found = false;
  while (queue.length > 0 && !found) {
    const current = queue.shift();
    if (!current) break;
    if (current.x === to.x && current.y === to.y) {
      found = true;
      break;
    }
    for (const dir of CARDINALS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (boulders[ny]![nx] || visited[ny]![nx]) continue;
      visited[ny]![nx] = true;
      parent.set(key(nx, ny), key(current.x, current.y));
      queue.push({ x: nx, y: ny });
    }
  }
  if (!found) return;
  let cursor = key(to.x, to.y);
  const target = key(from.x, from.y);
  while (cursor !== target) {
    const x = cursor % w;
    const y = Math.floor(cursor / w);
    castles[y]![x] = 0;
    const next = parent.get(cursor);
    if (next === undefined) break;
    cursor = next;
  }
}

export function pickPowerup(rng: Rng): PowerupKind | null {
  if (!rng.chance(CONFIG.POWERUP_BLOCK_CHANCE)) return null;
  const roll = rng.next();
  let cursor = 0;
  cursor += CONFIG.POWERUP_WEIGHTS.balloon;
  if (roll < cursor) return "balloon";
  cursor += CONFIG.POWERUP_WEIGHTS.splash;
  if (roll < cursor) return "splash";
  cursor += CONFIG.POWERUP_WEIGHTS.flippers;
  if (roll < cursor) return "flippers";
  return "boots";
}

export function generateArena(
  mode: GameMode,
  seed: number,
  theme?: ArenaTheme,
): Arena {
  const dims = CONFIG.ARENAS[mode];
  const w = dims.w;
  const h = dims.h;
  const rng = mulberry32(seed);
  const resolvedTheme = theme ?? rng.pick(ARENA_THEMES);
  const boulders = blankGrid(w, h, false);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      boulders[y]![x] = border || pillar;
    }
  }

  const castles = blankGrid(w, h, 0);
  const clear = blankGrid(w, h, false);
  const spawnTiles = spawnTilesForMode(mode, w, h);
  for (const spawn of spawnTiles) {
    clear[spawn.y]![spawn.x] = true;
    for (const dir of CARDINALS) {
      for (let step = 1; step <= 2; step += 1) {
        const x = spawn.x + dir.x * step;
        const y = spawn.y + dir.y * step;
        if (inBounds({ w, h }, x, y)) clear[y]![x] = true;
      }
    }
  }

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (boulders[y]![x] || clear[y]![x]) continue;
      if (rng.chance(CONFIG.CASTLE_DENSITY)) castles[y]![x] = 1;
    }
  }

  for (let i = 1; i < spawnTiles.length; i += 1) {
    const first = spawnTiles[0];
    const spawn = spawnTiles[i];
    if (!first || !spawn) continue;
    carvePath(boulders, castles, first, spawn, w, h);
  }

  const hidden = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => null as PowerupKind | null),
  );
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (castles[y]![x] === 1) {
        hidden[y]![x] = pickPowerup(rng);
      }
    }
  }

  return {
    w,
    h,
    theme: resolvedTheme,
    seed,
    boulders,
    castles,
    hidden,
    spawnTiles,
  };
}

export function tileIsSolid(arena: Arena, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= arena.w || y >= arena.h) return true;
  if (arena.boulders[y]?.[x]) return true;
  return arena.castles[y]?.[x] === 1;
}

export function distanceSquared(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
