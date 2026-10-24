import { CONFIG } from "./config.js";
import { mulberry32 } from "./rng.js";
import { TILE } from "./types.js";
import type { GameMode, MapData, PowerUpType, TileValue } from "./types.js";

export function mapIndex(map: Pick<MapData, "width">, x: number, y: number): number {
  return y * map.width + x;
}

export function spawnsFor(width: number, height: number, mode: GameMode, tutorial = false) {
  const corners = [
    { x: 1, y: 1 },
    { x: width - 2, y: height - 2 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 }
  ];
  return mode === "duel" || tutorial ? corners.slice(0, 2) : corners;
}

function isSpawnClear(x: number, y: number, spawns: { x: number; y: number }[]): boolean {
  for (const spawn of spawns) {
    if (spawn.x === x && spawn.y === y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let distance = 1; distance <= 2; distance += 1) {
        if (x === spawn.x + dx * distance && y === spawn.y + dy * distance) return true;
      }
    }
  }
  return false;
}

function rollPowerup(random: () => number): PowerUpType | null {
  if (random() >= CONFIG.POWERUP_BLOCK_CHANCE) return null;
  const weights = CONFIG.POWERUP_WEIGHTS;
  const roll = random();
  if (roll < weights.balloon) return "balloon";
  if (roll < weights.balloon + weights.range) return "range";
  if (roll < weights.balloon + weights.range + weights.speed) return "speed";
  return "kick";
}

export function generateMap(width: number, height: number, seed: number, mode: GameMode, tutorial = false): MapData {
  const random = mulberry32(seed);
  const spawns = spawnsFor(width, height, mode, tutorial);
  const tiles: TileValue[] = new Array<TileValue>(width * height).fill(TILE.FLOOR);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) {
        tiles[mapIndex({ width }, x, y)] = TILE.BOULDER;
      } else if (!isSpawnClear(x, y, spawns) && random() < CONFIG.CASTLE_DENSITY) {
        tiles[mapIndex({ width }, x, y)] = TILE.CASTLE;
      }
    }
  }
  const hiddenPowerups = tiles.map((tile) => tile === TILE.CASTLE ? rollPowerup(random) : null);
  return { width, height, tiles, hiddenPowerups, flooded: new Array<boolean>(width * height).fill(false), spawns };
}

export function syncTide(map: MapData, ring: number): number[] {
  const changed: number[] = [];
  if (ring <= 0) return changed;
  for (let y = 1; y < map.height - 1; y += 1) {
    for (let x = 1; x < map.width - 1; x += 1) {
      const tileRing = Math.min(x, y, map.width - 1 - x, map.height - 1 - y);
      if (tileRing < 1 || tileRing > ring) continue;
      const index = mapIndex(map, x, y);
      if (!map.flooded[index]) {
        map.flooded[index] = true;
        changed.push(index);
      }
    }
  }
  return changed;
}

export function tileAt(map: MapData, x: number, y: number): TileValue {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return TILE.BOULDER;
  return map.tiles[mapIndex(map, x, y)];
}
