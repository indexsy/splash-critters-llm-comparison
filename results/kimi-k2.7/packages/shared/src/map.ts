import { CONFIG, type Theme } from "./config.js";
import type { CastleCell } from "./types.js";
import { mulberry32, rngWeighted } from "./rng.js";

export const TILE_SIZE = 16;

export type MapGenResult = {
  width: number;
  height: number;
  theme: Theme;
  castles: (CastleCell | null)[][];
  spawns: { x: number; y: number }[];
};

export function isBoulder(width: number, height: number, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
  if (tx === 0 || ty === 0 || tx === width - 1 || ty === height - 1) return true;
  if (tx % 2 === 0 && ty % 2 === 0) return true;
  return false;
}

export function generateMap(mode: "duel" | "ffa", seed: number, theme: Theme): MapGenResult {
  const width = mode === "duel" ? CONFIG.DUEL_WIDTH : CONFIG.FFA_WIDTH;
  const height = mode === "duel" ? CONFIG.DUEL_HEIGHT : CONFIG.FFA_HEIGHT;
  const rng = mulberry32(seed);
  const castles: (CastleCell | null)[][] = Array.from({ length: width }, () => Array(height).fill(null));

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (isBoulder(width, height, x, y)) {
        castles[x][y] = null;
        continue;
      }
      if (rng() < CONFIG.CASTLE_DENSITY) {
        const powerUp = rng() < CONFIG.POWERUP_BLOCK_CHANCE
          ? rngWeighted(rng, CONFIG.POWERUP_WEIGHTS)
          : undefined;
        castles[x][y] = { hasCastle: true, powerUp };
      } else {
        castles[x][y] = null;
      }
    }
  }

  const spawns = mode === "duel"
    ? [{ x: 1, y: 1 }, { x: width - 2, y: height - 2 }]
    : [
        { x: 1, y: 1 },
        { x: width - 2, y: height - 2 },
        { x: 1, y: height - 2 },
        { x: width - 2, y: 1 },
      ];

  for (const s of spawns) {
    clearAround(castles, s.x, s.y, width, height);
  }

  return { width, height, theme, castles, spawns };
}

function clearAround(castles: (CastleCell | null)[][], tx: number, ty: number, width: number, height: number) {
  const dirs = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
  ];
  for (const d of dirs) {
    const nx = tx + d.x;
    const ny = ty + d.y;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height && !isBoulder(width, height, nx, ny)) {
      castles[nx][ny] = null;
    }
  }
}

export function themeBackground(theme: Theme): string {
  switch (theme) {
    case "backyard": return "#4a7c59";
    case "beach": return "#e6c288";
    case "pool": return "#4aa3ba";
  }
}

export function themeBoulder(theme: Theme): string {
  switch (theme) {
    case "backyard": return "#5a4a3a";
    case "beach": return "#7a7068";
    case "pool": return "#2f4f66";
  }
}

export function themeCastle(theme: Theme): string {
  switch (theme) {
    case "backyard": return "#d2b48c";
    case "beach": return "#f4e4bc";
    case "pool": return "#f0e6d2";
  }
}
