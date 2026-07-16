import { describe, expect, it } from 'vitest';
import { duelDelta, expectedScore, ffaDeltas, kFactor, tierFor } from '../src/elo.js';

describe('elo: duel', () => {
  it('equal ratings, new player wins: +/-32', () => {
    expect(duelDelta(1000, 1000, true, 0)).toBeCloseTo(32, 6);
    expect(duelDelta(1000, 1000, false, 0)).toBeCloseTo(-32, 6);
  });

  it('equal ratings, veteran wins: +16', () => {
    expect(duelDelta(1000, 1000, true, 25)).toBeCloseTo(16, 6);
  });

  it('higher rated winner gains less', () => {
    const e = expectedScore(1200, 1000);
    expect(e).toBeCloseTo(0.7597469, 5);
    expect(duelDelta(1200, 1000, true, 25)).toBeCloseTo(32 * (1 - 0.7597469), 3);
    expect(duelDelta(1000, 1200, true, 25)).toBeCloseTo(32 * (1 - 0.2402531), 3);
  });

  it('k-factor switches at 10 games', () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(9)).toBe(64);
    expect(kFactor(10)).toBe(32);
  });
});

describe('elo: ffa pairwise', () => {
  it('four equal new players: +32, +10.67, -10.67, -32', () => {
    const results = [
      { playerId: 'a', placement: 1, rating: 1000, games: 0 },
      { playerId: 'b', placement: 2, rating: 1000, games: 0 },
      { playerId: 'c', placement: 3, rating: 1000, games: 0 },
      { playerId: 'd', placement: 4, rating: 1000, games: 0 },
    ];
    const deltas = ffaDeltas(results);
    expect(deltas.get('a')).toBeCloseTo(32, 6);
    expect(deltas.get('b')).toBeCloseTo(10.6667, 3);
    expect(deltas.get('c')).toBeCloseTo(-10.6667, 3);
    expect(deltas.get('d')).toBeCloseTo(-32, 6);
    let sum = 0;
    for (const v of deltas.values()) sum += v;
    expect(sum).toBeCloseTo(0, 6);
  });

  it('tied placements split pair scores', () => {
    const results = [
      { playerId: 'a', placement: 1, rating: 1000, games: 20 },
      { playerId: 'b', placement: 1, rating: 1000, games: 20 },
      { playerId: 'c', placement: 3, rating: 1000, games: 20 },
      { playerId: 'd', placement: 3, rating: 1000, games: 20 },
    ];
    const deltas = ffaDeltas(results);
    expect(deltas.get('a')).toBeCloseTo(10.6667, 3);
    expect(deltas.get('b')).toBeCloseTo(10.6667, 3);
    expect(deltas.get('c')).toBeCloseTo(-10.6667, 3);
    expect(deltas.get('d')).toBeCloseTo(-10.6667, 3);
  });
});

describe('elo: tiers', () => {
  it('maps ratings to tiers', () => {
    expect(tierFor(900)).toBe('Puddle');
    expect(tierFor(1000)).toBe('Pond');
    expect(tierFor(1149)).toBe('Pond');
    expect(tierFor(1150)).toBe('River');
    expect(tierFor(1300)).toBe('Lake');
    expect(tierFor(1500)).toBe('Ocean');
    expect(tierFor(1750)).toBe('Tsunami');
    expect(tierFor(2400)).toBe('Tsunami');
  });
});
