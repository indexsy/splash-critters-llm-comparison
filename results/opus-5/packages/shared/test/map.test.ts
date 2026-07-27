import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  Tile,
  arenaSize,
  buildTideSchedule,
  generateMap,
  makeRng,
  spawnPoints,
} from '../src/index.js';

describe('seeded map generation', () => {
  it('produces an identical map and identical hidden contents for the same seed', () => {
    const a = generateMap('ffa', 42);
    const b = generateMap('ffa', 42);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(Array.from(a.castleContents)).toEqual(Array.from(b.castleContents));
  });

  it('produces a different map for a different seed', () => {
    const a = generateMap('ffa', 42);
    const b = generateMap('ffa', 43);
    expect(Array.from(a.cells)).not.toEqual(Array.from(b.cells));
  });

  it('actually buries some power-ups', () => {
    const map = generateMap('ffa', 7);
    const buried = Array.from(map.castleContents).filter((c) => c > 0);
    expect(buried.length).toBeGreaterThan(0);
    for (const code of buried) {
      expect(code).toBeLessThanOrEqual(CONFIG.POWERUP_WEIGHTS.length);
    }
  });

  it('only buries power-ups inside sandcastles', () => {
    const map = generateMap('duel', 99);
    for (let i = 0; i < map.cells.length; i++) {
      if (map.castleContents[i] > 0) expect(map.cells[i]).toBe(Tile.CASTLE);
    }
  });

  it('walls the border and pillars every even coordinate', () => {
    const map = generateMap('duel', 1);
    const { width, height } = arenaSize('duel');
    for (let x = 0; x < width; x++) {
      expect(map.cells[x]).toBe(Tile.BOULDER);
      expect(map.cells[(height - 1) * width + x]).toBe(Tile.BOULDER);
    }
    expect(map.cells[2 * width + 2]).toBe(Tile.BOULDER);
    expect(map.cells[4 * width + 6]).toBe(Tile.BOULDER);
  });

  it('keeps every spawn and its escape lanes clear', () => {
    for (const mode of ['duel', 'ffa'] as const) {
      const map = generateMap(mode, 2024);
      const { width, height } = arenaSize(mode);
      for (const spawn of spawnPoints(mode)) {
        expect(map.cells[spawn.y * width + spawn.x]).toBe(Tile.EMPTY);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          for (let step = 1; step <= CONFIG.SPAWN_CLEAR_RADIUS; step++) {
            const x = spawn.x + dx * step;
            const y = spawn.y + dy * step;
            if (x < 1 || y < 1 || x > width - 2 || y > height - 2) break;
            const tile = map.cells[y * width + x];
            if (tile === Tile.BOULDER) break;
            expect(tile).toBe(Tile.EMPTY);
          }
        }
      }
    }
  });

  it('gives duel opposite corners and free-for-all all four', () => {
    expect(spawnPoints('duel')).toHaveLength(2);
    expect(spawnPoints('ffa')).toHaveLength(4);
    expect(spawnPoints('duel')[0]).toEqual({ x: 1, y: 1 });
    expect(spawnPoints('duel')[1]).toEqual({ x: 11, y: 9 });
  });
});

describe('tide schedule', () => {
  it('floods the outer ring first and finishes each ring on time', () => {
    const { width, height } = arenaSize('ffa');
    const { order, ticks } = buildTideSchedule(width, height);
    expect(order.length).toBeGreaterThan(0);
    expect(ticks[0]).toBe(CONFIG.TIDE_START_TICKS);

    const firstTile = order[0];
    expect(firstTile % width).toBe(1);
    expect(Math.floor(firstTile / width)).toBe(1);

    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]);
    }
  });

  it('never floods a tile twice', () => {
    const { width, height } = arenaSize('duel');
    const { order } = buildTideSchedule(width, height);
    expect(new Set(Array.from(order)).size).toBe(order.length);
  });

  it('eventually floods every interior tile, leaving nowhere to hide', () => {
    for (const mode of ['duel', 'ffa'] as const) {
      const { width, height } = arenaSize(mode);
      const flooded = new Set(Array.from(buildTideSchedule(width, height).order));
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          expect(flooded.has(y * width + x)).toBe(true);
        }
      }
    }
  });
});

describe('mulberry32', () => {
  it('is reproducible and stays in range', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    for (let i = 0; i < 100; i++) {
      const value = a.next();
      expect(value).toBe(b.next());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('diverges for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });
});
