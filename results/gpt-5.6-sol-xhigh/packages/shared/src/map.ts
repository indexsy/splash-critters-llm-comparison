import { CONFIG } from "./config.js";
import { mulberry32 } from "./rng.js";
import type { ArenaMap, Mode, Point, PowerupKind, Tile } from "./types.js";

const key = (x: number, y: number): string => `${x},${y}`;

function rollPowerup(value: number): PowerupKind {
  let cursor = value;
  for (const [kind, weight] of Object.entries(CONFIG.POWERUP_WEIGHTS) as [PowerupKind, number][]) {
    cursor -= weight;
    if (cursor <= 0) return kind;
  }
  return "boots";
}

export function getSpawns(width: number, height: number, mode: Mode): Point[] {
  const corners = [
    { x: 1, y: 1 },
    { x: width - 2, y: height - 2 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 }
  ];
  return mode === "duel" ? corners.slice(0, 2) : corners;
}

export function generateMap(seed: number, mode: Mode): ArenaMap {
  const size = mode === "duel" ? CONFIG.DUEL_SIZE : CONFIG.FFA_SIZE;
  const random = mulberry32(seed);
  const spawns = getSpawns(size.width, size.height, mode);
  const protectedTiles = new Set<string>();
  for (const spawn of spawns) {
    protectedTiles.add(key(spawn.x, spawn.y));
    for (let offset = 1; offset <= 2; offset++) {
      protectedTiles.add(key(spawn.x + (spawn.x === 1 ? offset : -offset), spawn.y));
      protectedTiles.add(key(spawn.x, spawn.y + (spawn.y === 1 ? offset : -offset)));
    }
  }

  const tiles: Tile[][] = [];
  const hiddenPowerups: Record<string, PowerupKind> = {};
  for (let y = 0; y < size.height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < size.width; x++) {
      const border = x === 0 || y === 0 || x === size.width - 1 || y === size.height - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) {
        row.push(1);
      } else if (!protectedTiles.has(key(x, y)) && random() < CONFIG.CASTLE_DENSITY) {
        row.push(2);
        if (random() < CONFIG.POWERUP_BLOCK_CHANCE) hiddenPowerups[key(x, y)] = rollPowerup(random());
      } else {
        row.push(0);
      }
    }
    tiles.push(row);
  }
  return { width: size.width, height: size.height, seed, tiles, hiddenPowerups, spawns };
}

export function publicMap(map: ArenaMap): ArenaMap {
  return { ...map, tiles: map.tiles.map((row) => [...row]), hiddenPowerups: {} };
}

export const tileKey = key;
