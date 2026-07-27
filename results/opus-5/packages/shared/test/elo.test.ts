import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  computeEloDeltas,
  duelDeltas,
  expectedScore,
  kFactor,
  rankPlacements,
  tierForRating,
} from '../src/index.js';

describe('expected score', () => {
  it('is even between equal ratings', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
  });

  it('is 10:1 across 400 points', () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 10);
    expect(expectedScore(1000, 1400)).toBeCloseTo(1 / 11, 10);
  });
});

describe('K factor', () => {
  it('is boosted for the first ten games in a mode', () => {
    expect(kFactor(0)).toBe(CONFIG.ELO_K_PROVISIONAL);
    expect(kFactor(9)).toBe(CONFIG.ELO_K_PROVISIONAL);
    expect(kFactor(10)).toBe(CONFIG.ELO_K);
    expect(kFactor(500)).toBe(CONFIG.ELO_K);
  });
});

describe('duel elo', () => {
  it('moves a provisional even match by half of K', () => {
    const { winner, loser } = duelDeltas({ rating: 1000, games: 0 }, { rating: 1000, games: 0 });
    expect(winner).toBe(32);
    expect(loser).toBe(-32);
  });

  it('moves an established even match by half of the normal K', () => {
    const { winner, loser } = duelDeltas({ rating: 1200, games: 20 }, { rating: 1200, games: 40 });
    expect(winner).toBe(16);
    expect(loser).toBe(-16);
  });

  it('barely rewards a favourite and punishes an upset', () => {
    const favourite = duelDeltas({ rating: 1400, games: 20 }, { rating: 1000, games: 20 });
    expect(favourite.winner).toBe(3);
    expect(favourite.loser).toBe(-3);

    const upset = duelDeltas({ rating: 1000, games: 20 }, { rating: 1400, games: 20 });
    expect(upset.winner).toBe(29);
    expect(upset.loser).toBe(-29);
  });

  it('is zero sum for matched K factors', () => {
    const { winner, loser } = duelDeltas({ rating: 1337, games: 25 }, { rating: 1111, games: 25 });
    expect(winner + loser).toBe(0);
  });
});

describe('free-for-all pairwise elo', () => {
  const provisional = { rating: 1000, games: 0 };

  it('spreads a clean 1-2-3-4 finish symmetrically', () => {
    const deltas = computeEloDeltas([
      { ...provisional, placement: 1 },
      { ...provisional, placement: 2 },
      { ...provisional, placement: 3 },
      { ...provisional, placement: 4 },
    ]);
    expect(deltas).toEqual([32, 11, -11, -32]);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('uses K/3 so a sweep matches a duel win', () => {
    const ffa = computeEloDeltas([
      { ...provisional, placement: 1 },
      { ...provisional, placement: 4 },
      { ...provisional, placement: 4 },
      { ...provisional, placement: 4 },
    ]);
    expect(ffa[0]).toBe(32);
  });

  it('gives nothing away when everybody ties', () => {
    const deltas = computeEloDeltas([
      { ...provisional, placement: 1 },
      { ...provisional, placement: 1 },
      { ...provisional, placement: 1 },
      { ...provisional, placement: 1 },
    ]);
    expect(deltas).toEqual([0, 0, 0, 0]);
  });

  it('weights each pairing by the rating gap', () => {
    const deltas = computeEloDeltas([
      { rating: 1500, games: 50, placement: 1 },
      { rating: 1000, games: 50, placement: 2 },
      { rating: 1000, games: 50, placement: 3 },
      { rating: 1000, games: 50, placement: 4 },
    ]);
    // The favourite wins three near-certain pairings, so gains very little.
    expect(deltas[0]).toBeGreaterThan(0);
    expect(deltas[0]).toBeLessThan(6);
    expect(deltas[3]).toBeLessThan(0);
  });

  it('respects a player being provisional while the rest are not', () => {
    const deltas = computeEloDeltas([
      { rating: 1000, games: 0, placement: 1 },
      { rating: 1000, games: 100, placement: 2 },
      { rating: 1000, games: 100, placement: 3 },
      { rating: 1000, games: 100, placement: 4 },
    ]);
    expect(deltas[0]).toBe(32);
    expect(deltas[3]).toBe(-16);
  });
});

describe('placements', () => {
  it('orders on round wins then total soaks', () => {
    const placements = rankPlacements([
      { playerId: 'a', roundsWon: 1, soaks: 5 },
      { playerId: 'b', roundsWon: 3, soaks: 1 },
      { playerId: 'c', roundsWon: 1, soaks: 9 },
      { playerId: 'd', roundsWon: 0, soaks: 0 },
    ]);
    expect(placements.get('b')).toBe(1);
    expect(placements.get('c')).toBe(2);
    expect(placements.get('a')).toBe(3);
    expect(placements.get('d')).toBe(4);
  });

  it('lets genuinely tied players share a placement', () => {
    const placements = rankPlacements([
      { playerId: 'a', roundsWon: 2, soaks: 2 },
      { playerId: 'b', roundsWon: 2, soaks: 2 },
      { playerId: 'c', roundsWon: 0, soaks: 0 },
    ]);
    expect(placements.get('a')).toBe(1);
    expect(placements.get('b')).toBe(1);
    expect(placements.get('c')).toBe(3);
  });
});

describe('rank tiers', () => {
  it('maps ratings onto the configured bands', () => {
    expect(tierForRating(999).id).toBe('puddle');
    expect(tierForRating(1000).id).toBe('pond');
    expect(tierForRating(1149).id).toBe('pond');
    expect(tierForRating(1150).id).toBe('river');
    expect(tierForRating(1300).id).toBe('lake');
    expect(tierForRating(1500).id).toBe('ocean');
    expect(tierForRating(1750).id).toBe('tsunami');
    expect(tierForRating(9000).id).toBe('tsunami');
  });
});
