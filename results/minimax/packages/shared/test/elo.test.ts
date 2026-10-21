import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  duelElo,
  ffaElo,
  kFactor,
  placementsFromStandings,
  tierName,
  expectedScore,
} from '@splash-critters/shared';

describe('elo basics', () => {
  it('uses K=64 for the first ten games and 32 afterwards', () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(9)).toBe(64);
    expect(kFactor(10)).toBe(32);
    expect(kFactor(500)).toBe(32);
  });

  it('computes the expected score', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 10);
    expect(expectedScore(1200, 1000)).toBeCloseTo(1 / (1 + Math.pow(10, -200 / 400)), 10);
  });
});

describe('duel elo', () => {
  it('awards +32 to both players in an even match', () => {
    const [a, b] = duelElo({ rating: 1000, games: 0 }, { rating: 1000, games: 0 }, 1);
    expect(a.delta).toBe(32);
    expect(b.delta).toBe(-32);
    expect(a.ratingAfter).toBe(1032);
    expect(b.ratingAfter).toBe(968);
  });

  it('gives the favourite less than a full win', () => {
    // K = 32 after ten games, E(A) = 1 / (1 + 10^-0.5) = 0.7597
    const [a, b] = duelElo({ rating: 1200, games: 20 }, { rating: 1000, games: 20 }, 1);
    expect(a.delta).toBe(8);
    expect(b.delta).toBe(-8);
  });

  it('keeps the rating change zero sum', () => {
    const [a, b] = duelElo({ rating: 1410, games: 44 }, { rating: 1330, games: 12 }, 1);
    expect(a.ratingAfter + b.ratingAfter).toBe(a.ratingBefore + b.ratingBefore);
  });
});

describe('ffa elo', () => {
  it('splits the rating between four even players', () => {
    const players = Array.from({ length: 4 }, () => ({ rating: 1000, games: 0 }));
    const changes = ffaElo(players, [1, 2, 3, 4]);
    expect(changes[0].delta).toBe(32);
    expect(changes[1].delta).toBe(11);
    expect(changes[2].delta).toBe(-11);
    expect(changes[3].delta).toBe(-32);
    const sum = changes.reduce((acc, c) => acc + c.ratingAfter, 0);
    expect(sum).toBe(4000);
  });

  it('gives tied players the same delta', () => {
    const players = Array.from({ length: 4 }, () => ({ rating: 1000, games: 0 }));
    const changes = ffaElo(players, [1, 1, 3, 4]);
    expect(changes[0].delta).toBe(changes[1].delta);
  });

  it('awards more to the winner than the runner up', () => {
    const players = Array.from({ length: 4 }, () => ({ rating: 1000, games: 40 }));
    const changes = ffaElo(players, [1, 2, 3, 4]);
    expect(changes[0].delta).toBeGreaterThan(changes[1].delta);
    expect(changes[1].delta).toBeGreaterThan(changes[2].delta);
    expect(changes[2].delta).toBeGreaterThan(changes[3].delta);
    // with K=32 the winner gains 32/3 * 3 * 0.5 = 16
    expect(changes[0].delta).toBe(16);
    expect(changes[3].delta).toBe(-16);
  });
});

describe('placements', () => {
  it('ranks by round wins then soaks', () => {
    const placements = placementsFromStandings([
      { roundWins: 1, soaks: 2 },
      { roundWins: 2, soaks: 0 },
      { roundWins: 1, soaks: 5 },
      { roundWins: 0, soaks: 9 },
    ]);
    expect(placements).toEqual([3, 1, 2, 4]);
  });

  it('shares a placement for unresolved ties', () => {
    const placements = placementsFromStandings([
      { roundWins: 2, soaks: 3 },
      { roundWins: 2, soaks: 3 },
      { roundWins: 1, soaks: 1 },
      { roundWins: 0, soaks: 0 },
    ]);
    expect(placements).toEqual([1, 1, 3, 4]);
  });
});

describe('rank tiers', () => {
  it('maps ratings onto the configured bands', () => {
    expect(tierName(0)).toBe('Puddle');
    expect(tierName(999)).toBe('Puddle');
    expect(tierName(1000)).toBe('Pond');
    expect(tierName(1149)).toBe('Pond');
    expect(tierName(1150)).toBe('River');
    expect(tierName(1299)).toBe('River');
    expect(tierName(1300)).toBe('Lake');
    expect(tierName(1499)).toBe('Lake');
    expect(tierName(1500)).toBe('Ocean');
    expect(tierName(1749)).toBe('Ocean');
    expect(tierName(1750)).toBe('Tsunami');
    expect(tierName(3000)).toBe('Tsunami');
  });

  it('keeps the tier bands sorted', () => {
    for (let i = 1; i < CONFIG.TIERS.length; i++) {
      expect(CONFIG.TIERS[i].min).toBeGreaterThan(CONFIG.TIERS[i - 1].min);
    }
  });
});
