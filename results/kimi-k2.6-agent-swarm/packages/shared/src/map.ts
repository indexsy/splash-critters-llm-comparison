import { CONFIG } from './config.js';
import type { Tile, TilePos, PowerUpType } from './types.js';
import { mulberry32 } from './rng.js';

export interface GeneratedMap {
  width: number;
  height: number;
  grid: Tile[][];
  theme: 'backyard' | 'beach' | 'pool';
  spawnPoints: TilePos[];
  hiddenPowerUps: Map<string, PowerUpType>;
}

export function generateMap(seed: number, mode: 'duel' | 'ffa'): GeneratedMap {
  const rng = mulberry32(seed);
  const size = mode === 'duel' ? CONFIG.DUEL_SIZE : CONFIG.FFA_SIZE;
  const { width, height } = size;

  const grid: Tile[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'empty')
  );

  for (let x = 0; x < width; x++) {
    grid[0][x] = 'boulder';
    grid[height - 1][x] = 'boulder';
  }
  for (let y = 0; y < height; y++) {
    grid[y][0] = 'boulder';
    grid[y][width - 1] = 'boulder';
  }

  for (let y = 2; y < height - 1; y += 2) {
    for (let x = 2; x < width - 1; x += 2) {
      grid[y][x] = 'boulder';
    }
  }

  const spawnPoints: TilePos[] =
    mode === 'duel'
      ? [
          { x: 1, y: 1 },
          { x: width - 2, y: height - 2 },
        ]
      : [
          { x: 1, y: 1 },
          { x: width - 2, y: 1 },
          { x: 1, y: height - 2 },
          { x: width - 2, y: height - 2 },
        ];

  const clearTiles = new Set<string>();
  for (const spawn of spawnPoints) {
    clearTiles.add(`${spawn.x},${spawn.y}`);
    for (let d = 1; d <= 2; d++) {
      clearTiles.add(`${spawn.x},${spawn.y + d}`);
      clearTiles.add(`${spawn.x},${spawn.y - d}`);
      clearTiles.add(`${spawn.x + d},${spawn.y}`);
      clearTiles.add(`${spawn.x - d},${spawn.y}`);
    }
  }

  const candidates: TilePos[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y][x] === 'boulder') continue;
      if (clearTiles.has(`${x},${y}`)) continue;
      candidates.push({ x, y });
    }
  }

  const shuffled = shuffle(candidates, rng);
  const castleCount = Math.floor(candidates.length * CONFIG.CASTLE_DENSITY);
  for (let i = 0; i < castleCount; i++) {
    const pos = shuffled[i];
    grid[pos.y][pos.x] = 'sandcastle';
  }

  const hiddenPowerUps = new Map<string, PowerUpType>();
  for (let i = 0; i < castleCount; i++) {
    const pos = shuffled[i];
    if (rng() < CONFIG.POWERUP_BLOCK_CHANCE) {
      const powerUp = rollPowerUp(rng);
      hiddenPowerUps.set(`${pos.x},${pos.y}`, powerUp);
    }
  }

  const themes: GeneratedMap['theme'][] = ['backyard', 'beach', 'pool'];
  const theme = themes[Math.floor(rng() * themes.length)];

  return {
    width,
    height,
    grid,
    theme,
    spawnPoints,
    hiddenPowerUps,
  };
}

function shuffle<T>(array: T[], rng: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rollPowerUp(rng: () => number): PowerUpType {
  const weights = CONFIG.POWERUP_WEIGHTS;
  const r = rng();
  let cum = 0;
  cum += weights.extraBalloon;
  if (r < cum) return 'extraBalloon';
  cum += weights.bigSplash;
  if (r < cum) return 'bigSplash';
  cum += weights.flippers;
  if (r < cum) return 'flippers';
  return 'rubberBoots';
}

export function revealPowerUp(map: GeneratedMap, pos: TilePos): PowerUpType | null {
  const key = `${pos.x},${pos.y}`;
  const powerUp = map.hiddenPowerUps.get(key);
  if (powerUp) {
    map.hiddenPowerUps.delete(key);
    return powerUp;
  }
  return null;
}

export function getTile(map: GeneratedMap, pos: TilePos): Tile {
  return map.grid[pos.y]?.[pos.x] ?? 'empty';
}

export function setTile(map: GeneratedMap, pos: TilePos, tile: Tile): void {
  if (inBounds(map, pos)) {
    map.grid[pos.y][pos.x] = tile;
  }
}

export function inBounds(map: GeneratedMap, pos: TilePos): boolean {
  return pos.x >= 0 && pos.x < map.width && pos.y >= 0 && pos.y < map.height;
}

export function isSolid(map: GeneratedMap, pos: TilePos): boolean {
  const tile = getTile(map, pos);
  return tile === 'boulder' || tile === 'sandcastle' || tile === 'water';
}
