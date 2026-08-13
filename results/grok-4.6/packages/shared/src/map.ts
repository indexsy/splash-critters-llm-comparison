import { CONFIG, type ResolvedTheme } from "./config.js";
import { SeededRng } from "./rng.js";
import type {
  ArenaState,
  HiddenPowerup,
  PowerupKind,
  TileKind,
  Vec2,
} from "./types.js";
import { tileIndex } from "./types.js";

export interface GeneratedMap {
  arena: ArenaState;
  hidden: HiddenPowerup[];
  spawns: Vec2[];
}

export function spawnPositions(width: number, height: number, count: number): Vec2[] {
  const corners: Vec2[] = [
    { x: 1, y: 1 },
    { x: width - 2, y: height - 2 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
  ];
  return corners.slice(0, count);
}

function isSpawnClear(x: number, y: number, spawns: Vec2[]): boolean {
  for (const s of spawns) {
    if (x === s.x && y === s.y) return true;
    if (x === s.x && Math.abs(y - s.y) <= 2) return true;
    if (y === s.y && Math.abs(x - s.x) <= 2) return true;
  }
  return false;
}

export function generateMap(
  seed: number,
  width: number,
  height: number,
  theme: ResolvedTheme,
  playerCount: number,
): GeneratedMap {
  const rng = new SeededRng(seed);
  const tiles: TileKind[] = new Array(width * height).fill("empty");
  const spawns = spawnPositions(width, height, playerCount);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = tileIndex(x, y, width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        tiles[i] = "boulder";
        continue;
      }
      if (x % 2 === 0 && y % 2 === 0) {
        tiles[i] = "boulder";
      }
    }
  }

  for (const s of spawns) {
    tiles[tileIndex(s.x, s.y, width)] = "empty";
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= 2; step++) {
        const nx = s.x + d.x * step;
        const ny = s.y + d.y * step;
        if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
        const i = tileIndex(nx, ny, width);
        if (tiles[i] !== "boulder") tiles[i] = "empty";
      }
    }
  }

  const candidates: Vec2[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = tileIndex(x, y, width);
      if (tiles[i] !== "empty") continue;
      if (isSpawnClear(x, y, spawns)) continue;
      candidates.push({ x, y });
    }
  }

  const castleCount = Math.floor(candidates.length * CONFIG.CASTLE_DENSITY);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = tmp;
  }

  const hidden: HiddenPowerup[] = [];
  for (let i = 0; i < castleCount; i++) {
    const c = candidates[i]!;
    tiles[tileIndex(c.x, c.y, width)] = "castle";
    if (rng.chance(CONFIG.POWERUP_BLOCK_CHANCE)) {
      const kind = rng.weighted(CONFIG.POWERUP_WEIGHTS) as PowerupKind;
      hidden.push({ tx: c.x, ty: c.y, kind });
    }
  }

  return {
    arena: { width, height, tiles, theme, seed },
    hidden,
    spawns,
  };
}

export function resolveTheme(theme: string, seed: number): ResolvedTheme {
  if (theme === "backyard" || theme === "beach" || theme === "pool") return theme;
  const rng = new SeededRng(seed ^ 0x51a77e);
  return rng.pick(["backyard", "beach", "pool"] as const);
}
