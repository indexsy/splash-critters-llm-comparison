import { CONFIG } from "./config.js";
import { mulberry32 } from "./rng.js";
import { Tile, type Mode, type Point, type PowerupKind } from "./types.js";

export function generateMap(
  mode: Mode,
  seed: number,
  lootSeed: number | readonly number[] = seed ^ 0x718b45da,
) {
  const { width, height } = CONFIG.ARENAS[mode];
  const rng = mulberry32(seed);
  const loot = mulberry32(typeof lootSeed === "number" ? lootSeed : 0);
  const corners: Point[] = [
    { x: 1, y: 1 },
    { x: width - 2, y: height - 2 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
  ];
  const spawns = corners.slice(0, CONFIG.ARENAS[mode].players);
  const tiles: Tile[] = [];
  const hiddenPowerups: Record<number, PowerupKind> = {};
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const rock =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        (x % 2 === 0 && y % 2 === 0);
      const spawnClear = corners.some(
        (p) =>
          (x === p.x && Math.abs(y - p.y) <= 2) ||
          (y === p.y && Math.abs(x - p.x) <= 2),
      );
      tiles[index] = rock
        ? Tile.Boulder
        : !spawnClear && rng() < CONFIG.CASTLE_DENSITY
          ? Tile.Castle
          : Tile.Floor;
      const contents =
        typeof lootSeed === "number" ? loot : mulberry32(lootSeed[index]);
      if (
        tiles[index] === Tile.Castle &&
        contents() < CONFIG.POWERUP_BLOCK_CHANCE
      ) {
        let roll = contents();
        for (const [kind, weight] of Object.entries(CONFIG.POWERUP_WEIGHTS)) {
          roll -= weight;
          if (roll <= 0) {
            hiddenPowerups[index] = kind as PowerupKind;
            break;
          }
        }
      }
    }
  return { width, height, tiles, hiddenPowerups, spawns };
}
