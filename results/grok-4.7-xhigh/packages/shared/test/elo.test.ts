import { describe, expect, it } from 'vitest';
import { assignPlacements, duelDeltas, expectedScore, ffaDeltas, kFactor } from '../src/elo.js';

describe('elo', () => {
  it('uses K=64 for the first 10 games and K=32 after', () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(9)).toBe(64);
    expect(kFactor(10)).toBe(32);
  });

  it('matches duel fixtures', () => {
    const even = duelDeltas(1000, 1000, 10, 10, true);
    expect(even.deltaA).toBeCloseTo(16, 6);
    expect(even.deltaB).toBeCloseTo(-16, 6);

    const provisional = duelDeltas(1000, 1000, 0, 0, true);
    expect(provisional.deltaA).toBeCloseTo(32, 6);
    expect(provisional.deltaB).toBeCloseTo(-32, 6);

    const upset = duelDeltas(1200, 1000, 10, 10, true);
    const ea = expectedScore(1200, 1000);
    expect(upset.deltaA).toBeCloseTo(32 * (1 - ea), 6);
    expect(upset.deltaB).toBeCloseTo(32 * (0 - (1 - ea)), 6);
    expect(upset.deltaA).toBeCloseTo(7.688098347, 4);
    expect(upset.deltaB).toBeCloseTo(-7.688098347, 4);
  });

  it('matches 4p pairwise fixtures', () => {
    const players = [
      { id: 'A', rating: 1000, games: 10, placement: 1 },
      { id: 'B', rating: 1000, games: 10, placement: 2 },
      { id: 'C', rating: 1000, games: 10, placement: 3 },
      { id: 'D', rating: 1000, games: 10, placement: 4 },
    ];
    const d = ffaDeltas(players);
    expect(d.A).toBeCloseTo(16, 6);
    expect(d.B).toBeCloseTo(16 / 3, 6);
    expect(d.C).toBeCloseTo(-16 / 3, 6);
    expect(d.D).toBeCloseTo(-16, 6);

    const tied = ffaDeltas([
      { id: 'A', rating: 1000, games: 10, placement: 1 },
      { id: 'B', rating: 1000, games: 10, placement: 1 },
      { id: 'C', rating: 1000, games: 10, placement: 3 },
      { id: 'D', rating: 1000, games: 10, placement: 4 },
    ]);
    expect(tied.A).toBeCloseTo(32 / 3, 6);
    expect(tied.B).toBeCloseTo(32 / 3, 6);
    expect(tied.C).toBeCloseTo(-16 / 3, 6);
    expect(tied.D).toBeCloseTo(-16, 6);
  });

  it('shares placement on unresolved ties', () => {
    const place = assignPlacements([
      { id: 'a', roundWins: 2, soaks: 3 },
      { id: 'b', roundWins: 2, soaks: 3 },
      { id: 'c', roundWins: 1, soaks: 9 },
      { id: 'd', roundWins: 0, soaks: 0 },
    ]);
    expect(place.get('a')).toBe(1);
    expect(place.get('b')).toBe(1);
    expect(place.get('c')).toBe(3);
    expect(place.get('d')).toBe(4);
  });
});
