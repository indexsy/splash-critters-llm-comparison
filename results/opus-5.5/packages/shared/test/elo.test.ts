import { describe, expect, it } from 'vitest';
import {
  computePlacements,
  duelDeltas,
  expectedScore,
  ffaDeltas,
  kFactor,
  tierBand,
  tierFor,
} from '../src/elo';
import { CONFIG } from '../src/config';

const fresh = (rating: number) => ({ rating, games: 0 });

describe('expectedScore / kFactor', () => {
  it('is 0.5 for equal ratings and symmetric', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1, 12);
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.759747, 6);
  });

  it('uses the provisional K for the first ELO_PROVISIONAL_GAMES games', () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(CONFIG.ELO_PROVISIONAL_GAMES - 1)).toBe(64);
    expect(kFactor(CONFIG.ELO_PROVISIONAL_GAMES)).toBe(32);
    expect(kFactor(200)).toBe(32);
  });
});

describe('duelDeltas', () => {
  it('1000 vs 1000, both new: +32 / -32 (1032 / 968)', () => {
    const [w, l] = duelDeltas(fresh(1000), fresh(1000));
    expect([w, l]).toEqual([32, -32]);
    expect(1000 + w).toBe(1032);
    expect(1000 + l).toBe(968);
  });

  it('1200 (20 games) beats 1000 (20 games): +8 / -8', () => {
    expect(duelDeltas({ rating: 1200, games: 20 }, { rating: 1000, games: 20 })).toEqual([8, -8]);
  });

  it('upset: 1000 (20 games) beats 1200 (20 games): +24 / -24', () => {
    // K=32, E(1000 vs 1200) = 0.240253 -> 32 * 0.759747 = 24.31 -> 24
    expect(duelDeltas({ rating: 1000, games: 20 }, { rating: 1200, games: 20 })).toEqual([24, -24]);
  });

  it('each side uses its own K', () => {
    // winner provisional (K=64), loser established (K=32), equal ratings: +32 / -16
    expect(duelDeltas({ rating: 1000, games: 2 }, { rating: 1000, games: 50 })).toEqual([32, -16]);
  });
});

describe('ffaDeltas (pairwise, K/3 per opponent in 4p)', () => {
  it('four new 1000s, placements 1,2,3,4 -> +32, +11, -11, -32', () => {
    const players = [1, 2, 3, 4].map((placement) => ({ ...fresh(1000), placement }));
    expect(ffaDeltas(players)).toEqual([32, 11, -11, -32]);
  });

  it('four new 1000s, placements 1,2,2,4 -> +32, 0, 0, -32 (tie scores 0.5)', () => {
    const players = [1, 2, 2, 4].map((placement) => ({ ...fresh(1000), placement }));
    const deltas = ffaDeltas(players);
    expect(deltas).toEqual([32, 0, 0, -32]);
    expect(Object.is(deltas[1], -0)).toBe(false);
  });

  it('mixed ratings and K-factors (hand-computed)', () => {
    // A 1200 (20 games, K'=32/3) 3rd | B 1000 (0 games, K'=64/3) 2nd
    // C 1000 (12 games, K'=32/3) 4th | D  800 (3 games,  K'=64/3) 1st
    // E(1200v1000)=0.759747  E(1200v800)=0.909091  E(1000v800)=0.759747  E(1000v1000)=0.5
    // A: (0-0.909091) + (0-0.759747) + (1-0.759747)            = -1.428585 * 32/3 = -15.24 -> -15
    // B: (0-0.759747) + (1-0.240253) + (1-0.5)                 =  0.500000 * 64/3 =  10.67 ->  11
    // C: (0-0.759747) + (0-0.5)      + (0-0.240253)            = -1.500000 * 32/3 = -16.00 -> -16
    // D: (1-0.090909) + (1-0.240253) + (1-0.240253)            =  2.428585 * 64/3 =  51.81 ->  52
    const deltas = ffaDeltas([
      { rating: 1200, games: 20, placement: 3 },
      { rating: 1000, games: 0, placement: 2 },
      { rating: 1000, games: 12, placement: 4 },
      { rating: 800, games: 3, placement: 1 },
    ]);
    expect(deltas).toEqual([-15, 11, -16, 52]);
  });

  it('with two players equals a duel (a drawn duel moves ratings toward each other)', () => {
    const decided = ffaDeltas([
      { rating: 1200, games: 20, placement: 1 },
      { rating: 1000, games: 20, placement: 2 },
    ]);
    expect(decided).toEqual(duelDeltas({ rating: 1200, games: 20 }, { rating: 1000, games: 20 }));
    const drawn = ffaDeltas([
      { rating: 1200, games: 20, placement: 1 },
      { rating: 1000, games: 20, placement: 1 },
    ]);
    expect(drawn).toEqual([-8, 8]);
  });

  it('rejects fewer than two players', () => {
    expect(() => ffaDeltas([{ ...fresh(1000), placement: 1 }])).toThrow(RangeError);
  });
});

describe('tiers', () => {
  it.each([
    [999, 'puddle'],
    [0, 'puddle'],
    [1000, 'pond'],
    [1149, 'pond'],
    [1150, 'river'],
    [1299, 'river'],
    [1300, 'lake'],
    [1499, 'lake'],
    [1500, 'ocean'],
    [1749, 'ocean'],
    [1750, 'tsunami'],
    [3000, 'tsunami'],
  ] as const)('%i -> %s', (rating, tier) => {
    expect(tierFor(rating)).toBe(tier);
  });

  it('tierBand exposes bounds, next tier and progress', () => {
    const pond = tierBand(1075);
    expect(pond.id).toBe('pond');
    expect(pond.min).toBe(1000);
    expect(pond.max).toBe(1150);
    expect(pond.next?.id).toBe('river');
    expect(pond.progress).toBeCloseTo(0.5, 6);

    const puddle = tierBand(925);
    expect(puddle.id).toBe('puddle');
    expect(puddle.max).toBe(1000);
    expect(puddle.progress).toBeCloseTo(0.5, 6); // measured over 850..1000
    expect(tierBand(100).progress).toBe(0);

    const top = tierBand(1800);
    expect(top.id).toBe('tsunami');
    expect(top.next).toBeNull();
    expect(top.max).toBe(Infinity);
    expect(top.progress).toBe(1);
  });
});

describe('computePlacements', () => {
  const row = (slot: number, roundsWon: number, soaks: number, forfeited = false) => ({ slot, roundsWon, soaks, forfeited });

  it('ranks by round wins, then soaks', () => {
    const p = computePlacements([row(0, 1, 5), row(1, 3, 0), row(2, 1, 7), row(3, 0, 9)]);
    expect([p.get(0), p.get(1), p.get(2), p.get(3)]).toEqual([3, 1, 2, 4]);
  });

  it('exact ties share a placement with competition ranking (1,2,2,4)', () => {
    const p = computePlacements([row(0, 3, 4), row(1, 1, 2), row(2, 1, 2), row(3, 0, 0)]);
    expect([p.get(0), p.get(1), p.get(2), p.get(3)]).toEqual([1, 2, 2, 4]);
  });

  it('forfeited rows always rank after every non-forfeited row', () => {
    const p = computePlacements([row(0, 2, 9, true), row(1, 0, 0), row(2, 1, 1), row(3, 0, 0)]);
    expect(p.get(0)).toBe(4);
    expect([p.get(2), p.get(1), p.get(3)]).toEqual([1, 2, 2]);
  });

  it('a duel forfeit while ahead still loses', () => {
    const p = computePlacements([row(0, 2, 3, true), row(1, 0, 0)]);
    expect([p.get(0), p.get(1)]).toEqual([2, 1]);
  });

  it('multiple forfeits are ordered among themselves by the same keys', () => {
    const p = computePlacements([row(0, 0, 1, true), row(1, 1, 0, true), row(2, 0, 0), row(3, 0, 0)]);
    expect([p.get(2), p.get(3), p.get(1), p.get(0)]).toEqual([1, 1, 3, 4]);
  });
});
