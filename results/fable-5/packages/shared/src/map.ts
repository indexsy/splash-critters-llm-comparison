import { CONFIG, type GameMode, type PowerupType } from "./config.js";
import { mulberry32, rngWeighted } from "./rng.js";
import { TILE } from "./types.js";

export interface GeneratedMap {
  w: number;
  h: number;
  grid: number[];
  /** Pre-rolled hidden contents per tile (null = empty castle / not a castle). */
  contents: (PowerupType | null)[];
  spawns: { x: number; y: number }[];
}

export function spawnPoints(mode: GameMode): { x: number; y: number }[] {
  const { w, h } = CONFIG.ARENAS[mode];
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

/**
 * Deterministic map generation. The same (mode, seed) always yields the same
 * boulder layout, castle placement, AND hidden power-up contents — contents
 * are fixed the moment the map spawns and only revealed when a castle washes
 * away. RNG call order is fixed (row-major scan) so tests/replays match.
 */
export function generateMap(mode: GameMode, seed: number): GeneratedMap {
  const { w, h } = CONFIG.ARENAS[mode];
  const rng = mulberry32(seed);
  const grid: number[] = new Array(w * h).fill(TILE.EMPTY);
  const contents: (PowerupType | null)[] = new Array(w * h).fill(null);

  // Border + pillars at even (x,y) are indestructible boulders.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) grid[y * w + x] = TILE.BOULDER;
    }
  }

  // Spawn tile + 2 adjacent tiles per direction stay clear of castles.
  const spawns = spawnPoints(mode);
  const clear = new Set<number>();
  for (const s of spawns) {
    clear.add(s.y * w + s.x);
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      for (let i = 1; i <= 2; i++) {
        const x = s.x + dx * i;
        const y = s.y + dy * i;
        if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) break;
        clear.add(y * w + x);
      }
    }
  }

  // ~75% of remaining tiles become sandcastles, each with pre-rolled contents.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (grid[i] !== TILE.EMPTY || clear.has(i)) continue;
      if (rng() < CONFIG.CASTLE_DENSITY) {
        grid[i] = TILE.CASTLE;
        if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) {
          contents[i] = rngWeighted(rng, CONFIG.POWERUP_WEIGHTS);
        }
      }
    }
  }

  return { w, h, grid, contents, spawns };
}
