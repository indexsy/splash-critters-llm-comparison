import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { idx } from '../src/grid';
import { buildTutorialMap, decodeTiles, encodeTiles, generateMap, rollPowerUp, spawnTilesFor } from '../src/map';
import { mulberry32 } from '../src/rng';
import { PowerUp, Tile, type Mode } from '../src/types';

const MODES: Mode[] = ['duel', 'ffa'];

function isPillarOrBorder(w: number, h: number, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === w - 1 || y === h - 1 || (x % 2 === 0 && y % 2 === 0);
}

describe('generateMap determinism (acceptance)', () => {
  it('identical seed -> identical tiles AND identical hidden power-up contents', () => {
    for (const mode of MODES) {
      for (const seed of [1, 42, 123456789, 0xffffffff]) {
        const a = generateMap(mode, seed);
        const b = generateMap(mode, seed);
        expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
        expect(Array.from(a.hidden)).toEqual(Array.from(b.hidden));
        expect(a.spawns).toEqual(b.spawns);
      }
    }
  });

  it('different seeds give different maps', () => {
    const a = generateMap('ffa', 1);
    const b = generateMap('ffa', 2);
    const tilesDiffer = a.tiles.some((t, i) => t !== b.tiles[i]);
    const hiddenDiffer = a.hidden.some((t, i) => t !== b.hidden[i]);
    expect(tilesDiffer).toBe(true);
    expect(hiddenDiffer).toBe(true);
  });

  it('pins a known layout so generation stays stable across refactors and engines', () => {
    const m = generateMap('duel', 2024);
    expect(encodeTiles(m.tiles)).toBe(
      '1111111111111100002222222110121212101211022202220021101212121212112222222222211212121212101122020222000110' +
        '1212121210112222222200011111111111111',
    );
    expect(Array.from(m.hidden).join('')).toBe(
      '0000000000000000004300020000000100000000022002200000000000000000000010002000100100000000000020000100000000' +
        '0000000000000110000000000000000000000',
    );
  });

  it('draws hidden power-ups from an independent 128-bit content key (layout cannot reveal them)', () => {
    const keyA = [1, 2, 3, 4] as const;
    const keyB = [1, 2, 3, 5] as const;
    const base = generateMap('ffa', 77, keyA);
    const other = generateMap('ffa', 77, keyB);
    // Same layout seed -> identical public castle grid, whatever the content key.
    expect(encodeTiles(other.tiles)).toBe(encodeTiles(base.tiles));
    // A different key (even one bit) -> different hidden contents on that same grid.
    expect(other.hidden.some((k, i) => k !== base.hidden[i])).toBe(true);
    // Same (seed, key) pair -> identical contents (deterministic for replays).
    expect(Array.from(generateMap('ffa', 77, keyA).hidden)).toEqual(Array.from(base.hidden));
    // Contents only ever sit inside castles.
    base.hidden.forEach((k, i) => {
      if (k !== 0) expect(base.tiles[i]).toBe(2);
    });
  });
});

describe('generateMap structure', () => {
  it('uses the mode dimensions and corner spawns', () => {
    const duel = generateMap('duel', 5);
    expect([duel.w, duel.h]).toEqual([13, 11]);
    expect(duel.spawns).toEqual([
      { slot: 0, tx: 1, ty: 1 },
      { slot: 1, tx: 11, ty: 9 },
    ]);
    const ffa = generateMap('ffa', 5);
    expect([ffa.w, ffa.h]).toEqual([15, 13]);
    expect(ffa.spawns).toEqual(spawnTilesFor('ffa'));
    expect(ffa.spawns.map((sp) => [sp.slot, sp.tx, sp.ty])).toEqual([
      [0, 1, 1],
      [1, 13, 11],
      [2, 13, 1],
      [3, 1, 11],
    ]);
  });

  it('places boulders on the border and even/even pillars only', () => {
    for (const mode of MODES) {
      const m = generateMap(mode, 77);
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const boulder = m.tiles[idx(m.w, x, y)] === Tile.Boulder;
          expect(boulder).toBe(isPillarOrBorder(m.w, m.h, x, y));
        }
      }
    }
  });

  it('keeps every spawn of the mode plus SPAWN_CLEAR tiles per direction clear', () => {
    for (const mode of MODES) {
      for (let seed = 0; seed < 50; seed++) {
        const m = generateMap(mode, seed);
        for (const sp of m.spawns) {
          for (let d = -CONFIG.SPAWN_CLEAR; d <= CONFIG.SPAWN_CLEAR; d++) {
            for (const [x, y] of [
              [sp.tx + d, sp.ty],
              [sp.tx, sp.ty + d],
            ]) {
              if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
              expect(m.tiles[idx(m.w, x, y)]).not.toBe(Tile.Castle);
            }
          }
          expect(m.tiles[idx(m.w, sp.tx, sp.ty)]).toBe(Tile.Floor);
        }
      }
    }
  });

  it('hides power-ups only inside castles', () => {
    for (let seed = 0; seed < 30; seed++) {
      const m = generateMap('ffa', seed);
      const misplaced = [...m.hidden.keys()].filter((i) => m.hidden[i] !== PowerUp.None && m.tiles[i] !== Tile.Castle);
      expect(misplaced).toEqual([]);
      expect(Math.max(...m.hidden)).toBeLessThanOrEqual(PowerUp.Boots);
    }
  });

  it('matches CASTLE_DENSITY and POWERUP_BLOCK_CHANCE statistically', () => {
    let candidates = 0;
    let castles = 0;
    let loaded = 0;
    for (let seed = 0; seed < 300; seed++) {
      const m = generateMap('ffa', seed);
      const clearTiles = new Set<number>();
      for (const sp of m.spawns) {
        for (let d = -CONFIG.SPAWN_CLEAR; d <= CONFIG.SPAWN_CLEAR; d++) {
          clearTiles.add(idx(m.w, sp.tx + d, sp.ty));
          clearTiles.add(idx(m.w, sp.tx, sp.ty + d));
        }
      }
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const i = idx(m.w, x, y);
          if (isPillarOrBorder(m.w, m.h, x, y) || clearTiles.has(i)) continue;
          candidates++;
          if (m.tiles[i] === Tile.Castle) castles++;
          if (m.hidden[i] !== PowerUp.None) loaded++;
        }
      }
    }
    expect(castles / candidates).toBeCloseTo(CONFIG.CASTLE_DENSITY, 1);
    expect(loaded / castles).toBeCloseTo(CONFIG.POWERUP_BLOCK_CHANCE, 1);
  });
});

describe('rollPowerUp', () => {
  it('follows POWERUP_WEIGHTS in balloon, range, speed, boots order', () => {
    const rng = mulberry32(3);
    const counts = [0, 0, 0, 0, 0];
    const n = 40000;
    for (let i = 0; i < n; i++) counts[rollPowerUp(rng)]++;
    expect(counts[PowerUp.None]).toBe(0);
    const w = CONFIG.POWERUP_WEIGHTS;
    expect(counts[PowerUp.Balloon] / n).toBeCloseTo(w.balloon, 1);
    expect(counts[PowerUp.Range] / n).toBeCloseTo(w.range, 1);
    expect(counts[PowerUp.Speed] / n).toBeCloseTo(w.speed, 1);
    expect(counts[PowerUp.Boots] / n).toBeCloseTo(w.boots, 1);
  });
});

describe('tile encoding', () => {
  it('round-trips through the castleGrid string', () => {
    const m = generateMap('ffa', 9);
    const s = encodeTiles(m.tiles);
    expect(s).toMatch(/^[012]+$/);
    expect(s.length).toBe(m.w * m.h);
    expect(Array.from(decodeTiles(s))).toEqual(Array.from(m.tiles));
  });

  it('rejects unknown tile codes', () => {
    expect(() => decodeTiles('0123')).toThrow(/invalid tile code/);
  });
});

describe('buildTutorialMap', () => {
  const m = buildTutorialMap();
  const at = (x: number, y: number) => m.tiles[idx(m.w, x, y)];

  it('is an 11x9 arena with the player on the left and the bot on the right', () => {
    expect([m.w, m.h]).toEqual([11, 9]);
    expect(m.spawns).toEqual([
      { slot: 0, tx: 1, ty: 4 },
      { slot: 1, tx: 9, ty: 4 },
    ]);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        expect(at(x, y) === Tile.Boulder).toBe(isPillarOrBorder(m.w, m.h, x, y));
      }
    }
  });

  it('hides Extra Balloons in the castles nearest the player spawn, nowhere else', () => {
    const loaded = [...m.hidden.keys()].filter((i) => m.hidden[i] !== PowerUp.None);
    expect(loaded.map((i) => [i % m.w, Math.floor(i / m.w)])).toEqual([
      [2, 3],
      [2, 5],
    ]);
    for (const i of loaded) expect(m.hidden[i]).toBe(PowerUp.Balloon);
  });

  it('seals the player pocket with castles so the bot cannot walk in', () => {
    const seen = new Set<number>([idx(m.w, 1, 4)]);
    const queue: [number, number][] = [[1, 4]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        const i = idx(m.w, nx, ny);
        if (at(nx, ny) !== Tile.Floor || seen.has(i)) continue;
        seen.add(i);
        queue.push([nx, ny]);
      }
    }
    expect(seen.has(idx(m.w, 9, 4))).toBe(false);
    expect(seen.size).toBe(13); // column 1 (7) + row 1 x2..4 (3) + row 7 x2..4 (3)
  });

  it('places chainable castle pairs along rows 3 and 5', () => {
    for (const [x, y] of [
      [3, 2],
      [5, 2],
      [3, 6],
      [5, 6],
    ]) {
      expect(at(x, y)).toBe(Tile.Castle);
    }
    for (let x = 3; x <= 9; x++) {
      expect(at(x, 3)).toBe(Tile.Floor);
      expect(at(x, 5)).toBe(Tile.Floor);
    }
  });
});
