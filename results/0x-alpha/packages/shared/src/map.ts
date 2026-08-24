import { CONFIG, type MapTheme } from "./config";
import { Rng } from "./rng";
import type { HiddenPowerup, MatchConfig } from "./types";

export const TILE_FLOOR = 0;
export const TILE_BOULDER = 1;
export const TILE_CASTLE = 2;
export const TILE_FLOODED = 3;

export interface GeneratedMap {
  w: number;
  h: number;
  grid: Uint8Array;
  hidden: HiddenPowerup[];
  spawns: Array<{ x: number; y: number; dirX: number; dirY: number }>;
}

export function arenaSize(mode: "duel" | "ffa"): { w: number; h: number; maxPlayers: number } {
  return mode === "duel" ? { w: 13, h: 11, maxPlayers: 2 } : { w: 15, h: 13, maxPlayers: 4 };
}

/** Boulders at even (x,y); border walls. */
function baseGrid(w: number, h: number): Uint8Array {
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) grid[y * w + x] = TILE_BOULDER;
      else if (x % 2 === 0 && y % 2 === 0) grid[y * w + x] = TILE_BOULDER;
    }
  }
  return grid;
}

/** Spawn corners with the spawn tile + 2 adjacent tiles per direction kept clear. */
function computeSpawns(mode: "duel" | "ffa", w: number, h: number) {
  if (mode === "duel") {
    return [
      { x: 1, y: 1, dirX: 1, dirY: 0 },
      { x: w - 2, y: h - 2, dirX: -1, dirY: 0 },
    ];
  }
  return [
    { x: 1, y: 1, dirX: 1, dirY: 0 },
    { x: w - 2, y: 1, dirX: -1, dirY: 0 },
    { x: 1, y: h - 2, dirX: 1, dirY: 0 },
    { x: w - 2, y: h - 2, dirX: -1, dirY: 0 },
  ];
}

/** Clear spawn tile + 2 tiles in each direction (row & column through the spawn). */
function clearSpawnArea(grid: Uint8Array, w: number, h: number, sx: number, sy: number): void {
  const clear = (x: number, y: number) => {
    if (x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2) grid[y * w + x] = TILE_FLOOR;
  };
  for (let i = -2; i <= 2; i++) {
    clear(sx + i, sy);
    clear(sx, sy + i);
  }
}

/**
 * Generate a deterministic arena. Every sandcastle's hidden power-up content is
 * pre-rolled here with the round's seeded PRNG and never sent to clients.
 */
export function generateMap(cfg: MatchConfig): GeneratedMap {
  const { w, h } = cfg;
  const rng = new Rng(cfg.mapSeed);
  const grid = baseGrid(w, h);
  const spawns = computeSpawns(cfg.mode, w, h);

  const candidates: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const t = y * w + x;
      if (grid[t] === TILE_FLOOR) candidates.push(t);
    }
  }

  // Clear spawn areas first, remembering which tiles were cleared
  const cleared = new Set<number>();
  for (const s of spawns) {
    for (let i = -2; i <= 2; i++) {
      if (s.x + i >= 1 && s.x + i <= w - 2) cleared.add(s.y * w + s.x + i);
      if (s.y + i >= 1 && s.y + i <= h - 2) cleared.add((s.y + i) * w + s.x);
    }
    clearSpawnArea(grid, w, h, s.x, s.y);
  }

  const openTiles = candidates.filter((t) => grid[t] === TILE_FLOOR && !cleared.has(t));
  const shuffled = openTiles.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const castleCount = Math.floor(openTiles.length * CONFIG.castleDensity);
  const castleSet = new Set(shuffled.slice(0, castleCount));
  for (const t of castleSet) grid[t] = TILE_CASTLE;

  // Pre-roll hidden contents
  const hidden: HiddenPowerup[] = [];
  for (const t of castleSet) {
    let type: HiddenPowerup["type"] = null;
    if (rng.next() < CONFIG.powerupBlockChance) {
      const r = rng.next();
      const pw = CONFIG.powerupWeights;
      type =
        r < pw.balloon
          ? "balloon"
          : r < pw.balloon + pw.range
            ? "range"
            : r < pw.balloon + pw.range + pw.speed
              ? "speed"
              : "boots";
    }
    hidden.push({ tile: t, type });
  }

  return { w, h, grid, hidden, spawns };
}

export function defaultMatchConfig(
  mode: "duel" | "ffa",
  opts?: Partial<Pick<MatchConfig, "theme" | "roundsToWin" | "ranked" | "mapSeed" | "enableRevengeDucks">>,
): MatchConfig {
  const size = arenaSize(mode);
  
  return {
    mode,
    ranked: false,
    theme: opts?.theme ?? rngTheme(),
    roundsToWin: opts?.roundsToWin ?? CONFIG.roundsToWinDefault,
    w: size.w,
    h: size.h,
    maxPlayers: size.maxPlayers,
    enableKick: CONFIG.enableKick,
    enableRevengeDucks:
      opts?.enableRevengeDucks ?? (opts?.ranked ? CONFIG.enableRevengeDucksRanked : CONFIG.enableRevengeDucksCasual),
    mapSeed: opts?.mapSeed ?? (Math.random() * 0xffffffff) >>> 0,
  };
}

const THEMES: MapTheme[] = ["backyard", "beach", "pool"];
let themeRng = new Rng(Date.now() >>> 0);
export function rngTheme(): MapTheme {
  return themeRng.pick(THEMES);
}
