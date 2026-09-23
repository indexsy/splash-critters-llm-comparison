import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, randInt, sfc32 } from '../src/rng';

describe('mulberry32', () => {
  it('replays the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBeLessThan(2);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const rng = mulberry32(7);
    const buckets = new Array(10).fill(0);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 20000; i++) {
      const v = rng();
      min = Math.min(min, v);
      max = Math.max(max, v);
      buckets[Math.floor(v * 10)]++;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    for (const n of buckets) expect(n).toBeGreaterThan(1800);
  });

  it('matches known reference outputs (portable across engines)', () => {
    const rng = mulberry32(0);
    const first = [rng(), rng(), rng()].map((v) => Math.floor(v * 4294967296));
    expect(first).toEqual([1144304738, 1416247, 958946056]);
  });
});

describe('hashSeed', () => {
  it('is a stable uint32', () => {
    const h = hashSeed(1, 2, 3);
    expect(h).toBe(hashSeed(1, 2, 3));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('depends on order, arity and high bits', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(1)).not.toBe(hashSeed(1, 0));
    expect(hashSeed(1_700_000_000_000)).not.toBe(hashSeed(1_700_000_000_000 + 2 ** 32));
  });
});

describe('randInt', () => {
  it('covers exactly [0, n)', () => {
    const rng = mulberry32(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randInt(rng, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });
});

describe('sfc32 (128-bit content stream)', () => {
  it('is deterministic per key and diverges for keys one bit apart', () => {
    const take = (key: readonly [number, number, number, number]) => {
      const r = sfc32(key);
      return Array.from({ length: 8 }, () => r());
    };
    expect(take([7, 8, 9, 10])).toEqual(take([7, 8, 9, 10]));
    const a = take([7, 8, 9, 10]);
    const b = take([7, 8, 9, 11]);
    expect(a.filter((v, i) => v === b[i])).toHaveLength(0);
  });

  it('returns floats in [0, 1) with a sane mean', () => {
    const r = sfc32([0xdeadbeef, 1, 2, 3]);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(Math.abs(sum / 20000 - 0.5)).toBeLessThan(0.02);
  });
});
