import { describe, expect, it } from 'vitest';
import { duelDeltas, expectedScore, ffaDeltas, placementsFromResults } from '../src/elo';
import { tierForRating } from '../src/config';

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
  });
  it('favours the higher-rated player', () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
  });
});

describe('duel Elo', () => {
  it('even 1000 vs 1000, both provisional (K=64) => +32 / -32', () => {
    const d = duelDeltas(1000, 1000, 0, 0);
    expect(d.winner).toBe(32);
    expect(d.loser).toBe(-32);
  });

  it('favourite 1200 (est) beats 1000 (est), K=32 => +8 / -8', () => {
    const d = duelDeltas(1200, 1000, 20, 20);
    expect(d.winner).toBe(8);
    expect(d.loser).toBe(-8);
  });

  it('is (approximately) zero-sum when K factors match', () => {
    const d = duelDeltas(1100, 1050, 20, 20);
    expect(d.winner + d.loser).toBe(0);
  });
});

describe('FFA pairwise Elo', () => {
  it('four equal 1000s placed 1-2-3-4 (K=64) => [32, 11, -11, -32], zero-sum', () => {
    const deltas = ffaDeltas([
      { rating: 1000, games: 0, placement: 1 },
      { rating: 1000, games: 0, placement: 2 },
      { rating: 1000, games: 0, placement: 3 },
      { rating: 1000, games: 0, placement: 4 },
    ]);
    expect(deltas).toEqual([32, 11, -11, -32]);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('shared placement gives equal treatment', () => {
    const deltas = ffaDeltas([
      { rating: 1000, games: 0, placement: 1 },
      { rating: 1000, games: 0, placement: 2 },
      { rating: 1000, games: 0, placement: 2 },
      { rating: 1000, games: 0, placement: 4 },
    ]);
    expect(deltas[1]).toBe(deltas[2]); // the two tied players move the same
  });
});

describe('placementsFromResults', () => {
  it('ranks by round wins then soaks, sharing ties', () => {
    const p = placementsFromResults([
      { roundWins: 3, soaks: 5 },
      { roundWins: 1, soaks: 2 },
      { roundWins: 2, soaks: 9 },
      { roundWins: 1, soaks: 2 },
    ]);
    expect(p).toEqual([1, 3, 2, 3]);
  });
});

describe('rank tiers', () => {
  it('maps ratings to the right band', () => {
    expect(tierForRating(900).id).toBe('puddle');
    expect(tierForRating(1000).id).toBe('pond');
    expect(tierForRating(1200).id).toBe('river');
    expect(tierForRating(1400).id).toBe('lake');
    expect(tierForRating(1600).id).toBe('ocean');
    expect(tierForRating(2000).id).toBe('tsunami');
  });
});
