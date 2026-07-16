import { CONFIG, type MapTheme, type PowerupType } from './config.js';
import { mulberry32, pickWeighted } from './rng.js';
import { idx, type HiddenPowerup } from './types.js';

export const TILE_EMPTY = 0;
export const TILE_BOULDER = 1;
export const TILE_CASTLE = 2;

export type GeneratedMap = {
  width: number;
  height: number;
  grid: number[];
  hiddenPowerups: HiddenPowerup[];
  spawns: Array<{ x: number; y: number }>;
  theme: MapTheme;
};

function resolveTheme(theme: MapTheme, rng: () => number): Exclude<MapTheme, 'random'> {
  if (theme !== 'random') return theme;
  const themes: Exclude<MapTheme, 'random'>[] = ['backyard', 'beach', 'pool'];
  return themes[Math.floor(rng() * themes.length)]!;
}

/** Corner spawns for FFA / opposite corners for Duel */
export function getSpawnPositions(width: number, height: number, count: number): Array<{ x: number; y: number }> {
  const corners = [
    { x: 1, y: 1 },
    { x: width - 2, y: height - 2 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
  ];
  if (count === 2) return [corners[0]!, corners[1]!];
  return corners.slice(0, count);
}

function clearAroundSpawn(grid: number[], width: number, height: number, sx: number, sy: number): void {
  const clears = [
    { x: sx, y: sy },
    { x: sx + 1, y: sy },
    { x: sx - 1, y: sy },
    { x: sx, y: sy + 1 },
    { x: sx, y: sy - 1 },
  ];
  for (const c of clears) {
    if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) {
      const i = idx(c.x, c.y, width);
      if (grid[i] !== TILE_BOULDER) grid[i] = TILE_EMPTY;
    }
  }
}

export function generateMap(
  width: number,
  height: number,
  seed: number,
  playerCount: number,
  theme: MapTheme = 'random',
): GeneratedMap {
  const rng = mulberry32(seed);
  const resolvedTheme = resolveTheme(theme, rng);
  const grid = new Array(width * height).fill(TILE_EMPTY);

  // Border boulders
  for (let x = 0; x < width; x++) {
    grid[idx(x, 0, width)] = TILE_BOULDER;
    grid[idx(x, height - 1, width)] = TILE_BOULDER;
  }
  for (let y = 0; y < height; y++) {
    grid[idx(0, y, width)] = TILE_BOULDER;
    grid[idx(width - 1, y, width)] = TILE_BOULDER;
  }

  // Pillars at even (x,y)
  for (let y = 2; y < height - 1; y += 2) {
    for (let x = 2; x < width - 1; x += 2) {
      grid[idx(x, y, width)] = TILE_BOULDER;
    }
  }

  // Sandcastles on remaining empty tiles
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[idx(x, y, width)] === TILE_EMPTY) {
        candidates.push({ x, y });
      }
    }
  }

  // Shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }

  const castleCount = Math.floor(candidates.length * CONFIG.CASTLE_DENSITY);
  const hiddenPowerups: HiddenPowerup[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (i < castleCount) {
      grid[idx(c.x, c.y, width)] = TILE_CASTLE;
      let type: PowerupType | null = null;
      if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) {
        type = pickWeighted(rng, CONFIG.POWERUP_WEIGHTS);
      }
      hiddenPowerups.push({ x: c.x, y: c.y, type });
    }
  }

  const spawns = getSpawnPositions(width, height, playerCount);
  for (const s of spawns) {
    clearAroundSpawn(grid, width, height, s.x, s.y);
    // Remove hidden powerups from cleared tiles
    for (let i = hiddenPowerups.length - 1; i >= 0; i--) {
      const hp = hiddenPowerups[i]!;
      if (grid[idx(hp.x, hp.y, width)] !== TILE_CASTLE) {
        hiddenPowerups.splice(i, 1);
      }
    }
  }

  return { width, height, grid, hiddenPowerups, spawns, theme: resolvedTheme };
}

export function dimensionsForMode(mode: 'duel' | 'ffa'): { width: number; height: number } {
  if (mode === 'duel') return { width: CONFIG.DUEL_WIDTH, height: CONFIG.DUEL_HEIGHT };
  return { width: CONFIG.FFA_WIDTH, height: CONFIG.FFA_HEIGHT };
}
