// map.ts — deterministic map generation. Identical seed => identical tiles AND
// identical hidden power-up contents (spec §4). Hidden contents are stored in
// the state but never serialized into client-facing snapshots until revealed.

import { Rng } from "./rng.js";
import { CASTLE_DENSITY, POWERUP_BLOCK_CHANCE, POWERUP_WEIGHTS, type GameMode } from "./config.js";
import type { PowerUpKind, TileKind } from "./types.js";

export interface GeneratedMap {
  width: number;
  height: number;
  tiles: Uint8Array; // TileKind
  hiddenPowerUps: (PowerUpKind | "")[]; // length width*height; "" means none
  spawns: { x: number; y: number }[];
}

export function arenaSize(mode: GameMode): { w: number; h: number } {
  if (mode === "duel") return { w: 13, h: 11 };
  return { w: 15, h: 13 };
}

/**
 * Generate a round map. Boulders at even (x,y); sandcastles fill ~75% of empty
 * tiles, but spawn tiles + 2 adjacent tiles per direction are kept clear.
 */
export function generateMap(seed: number, mode: GameMode): GeneratedMap {
  const { w, h } = arenaSize(mode);
  const rng = new Rng(seed);
  const tiles = new Uint8Array(w * h);

  const idx = (x: number, y: number) => y * w + x;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  // Spawns: FFA = four corners; Duel = opposite corners.
  const spawns =
    mode === "duel"
      ? [
          { x: 1, y: 1 },
          { x: w - 2, y: h - 2 },
        ]
      : [
          { x: 1, y: 1 },
          { x: w - 2, y: 1 },
          { x: 1, y: h - 2 },
          { x: w - 2, y: h - 2 },
        ];

  // Tiles that must stay clear (spawn + 2 adjacent in each cardinal dir)
  const clear = new Set<number>();
  for (const s of spawns) {
    clear.add(idx(s.x, s.y));
    for (let d = 0; d < 4; d++) {
      const dx = [0, 1, 0, -1][d];
      const dy = [-1, 0, 1, 0][d];
      for (let step = 1; step <= 2; step++) {
        const nx = s.x + dx * step;
        const ny = s.y + dy * step;
        if (inBounds(nx, ny)) clear.add(idx(nx, ny));
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      // Border
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        tiles[i] = 1; // boulder border
        continue;
      }
      // Pillars at even (x,y)
      if (x % 2 === 0 && y % 2 === 0) {
        tiles[i] = 1; // boulder pillar
        continue;
      }
      if (clear.has(i)) {
        tiles[i] = 0;
        continue;
      }
      // ~75% sandcastle
      tiles[i] = rng.next() < CASTLE_DENSITY ? 2 : 0;
    }
  }

  // Pre-roll hidden power-ups for every sandcastle (deterministic per seed).
  const hiddenPowerUps: PowerUpKind[] = new Array(w * h).fill("");
  for (let i = 0; i < w * h; i++) {
    if (tiles[i] !== 2) continue;
    if (rng.next() < POWERUP_BLOCK_CHANCE) continue; // empty castle
    const r = rng.next();
    let acc = 0;
    let chosen: PowerUpKind = "extraBalloon";
    const table: [PowerUpKind, number][] = [
      ["extraBalloon", POWERUP_WEIGHTS.extraBalloon],
      ["bigSplash", POWERUP_WEIGHTS.bigSplash],
      ["flippers", POWERUP_WEIGHTS.flippers],
      ["rubberBoots", POWERUP_WEIGHTS.rubberBoots],
    ];
    for (const [kind, wt] of table) {
      acc += wt;
      if (r < acc) {
        chosen = kind;
        break;
      }
    }
    hiddenPowerUps[i] = chosen;
  }

  return { width: w, height: h, tiles, hiddenPowerUps, spawns };
}

export function tileAt(map: { tiles: Uint8Array; width: number }, x: number, y: number): TileKind {
  return map.tiles[y * map.width + x] as TileKind;
}
