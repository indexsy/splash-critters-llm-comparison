import { describe, expect, it } from 'vitest';
import { duelDelta, ffaDeltas } from '../src/elo.js';

describe('elo', () => {
  it('duel: upset win gains more', () => {
    const d = duelDelta('under', 'fav', {
      under: { rating: 900, games: 20 },
      fav: { rating: 1200, games: 20 },
    });
    // E(900 vs 1200) ~ 0.15, K=32 -> +27
    expect(d['under']).toBeGreaterThan(20);
    expect(d['under'] + d['fav']).toBeGreaterThanOrEqual(-1);
    expect(d['under'] + d['fav']).toBeLessThanOrEqual(1);
  });

  it('duel fixture: equal ratings -> +-16', () => {
    const d = duelDelta('a', 'b', {
      a: { rating: 1000, games: 20 },
      b: { rating: 1000, games: 20 },
    });
    expect(d['a']).toBe(16);
    expect(d['b']).toBe(-16);
  });

  it('duel new player K=64', () => {
    const d = duelDelta('a', 'b', {
      a: { rating: 1000, games: 2 },
      b: { rating: 1000, games: 50 },
    });
    expect(d['a']).toBe(32);
    expect(d['b']).toBe(-16);
  });

  it('ffa 4p pairwise: winner gains, last loses', () => {
    const ratings = {
      p1: { rating: 1200, games: 20 },
      p2: { rating: 1100, games: 20 },
      p3: { rating: 1000, games: 20 },
      p4: { rating: 900, games: 20 },
    };
    const d = ffaDeltas([['p1'], ['p2'], ['p3'], ['p4']], ratings);
    expect(d['p1']).toBeGreaterThan(0);
    expect(d['p4']).toBeLessThan(0);
    expect(d['p2']).toBeGreaterThan(d['p3']);
  });

  it('ffa tie shares placement (0.5)', () => {
    const ratings = {
      p1: { rating: 1000, games: 20 },
      p2: { rating: 1000, games: 20 },
      p3: { rating: 1000, games: 20 },
      p4: { rating: 1000, games: 20 },
    };
    const d = ffaDeltas([['p1', 'p2'], ['p3'], ['p4']], ratings);
    expect(d['p1']).toBe(d['p2']);
    expect(d['p1']).toBeGreaterThan(d['p3']);
  });

  it('ffa fixture values match expected', () => {
    // All 1000, K=32 -> K'=10.667. Winner 3-0 vs all: 3*10.667*0.5 = 16
    const ratings = {
      a: { rating: 1000, games: 20 },
      b: { rating: 1000, games: 20 },
      c: { rating: 1000, games: 20 },
      d: { rating: 1000, games: 20 },
    };
    const del = ffaDeltas([['a'], ['b'], ['c'], ['d']], ratings);
    expect(del['a']).toBe(16);
    expect(del['d']).toBe(-16);
    expect(del['b']).toBe(5);
    expect(del['c']).toBe(-5);
  });
});
