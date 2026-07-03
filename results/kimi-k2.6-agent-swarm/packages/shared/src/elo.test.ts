import { describe, it, expect } from 'vitest';
import { calculateDuelElo, calculateFFAElo, getKFactor, getTier } from './elo.js';

describe('getKFactor', () => {
  it('returns 64 for first 10 games', () => {
    expect(getKFactor(0)).toBe(64);
    expect(getKFactor(5)).toBe(64);
    expect(getKFactor(9)).toBe(64);
  });
  it('returns 32 after 10 games', () => {
    expect(getKFactor(10)).toBe(32);
    expect(getKFactor(50)).toBe(32);
  });
});

describe('getTier', () => {
  it('returns correct tiers', () => {
    expect(getTier(999)).toBe('Puddle');
    expect(getTier(1000)).toBe('Pond');
    expect(getTier(1149)).toBe('Pond');
    expect(getTier(1150)).toBe('River');
    expect(getTier(1299)).toBe('River');
    expect(getTier(1300)).toBe('Lake');
    expect(getTier(1499)).toBe('Lake');
    expect(getTier(1500)).toBe('Ocean');
    expect(getTier(1749)).toBe('Ocean');
    expect(getTier(1750)).toBe('Tsunami');
    expect(getTier(2000)).toBe('Tsunami');
  });
});

describe('calculateDuelElo', () => {
  it('equal ratings: winner gains half K, loser loses half K', () => {
    const result = calculateDuelElo(1000, 1000, 0, 0);
    // E = 0.5, delta = K * (1 - 0.5) = 64 * 0.5 = 32
    expect(result.winnerNew).toBe(1032);
    expect(result.loserNew).toBe(968);
    expect(result.delta).toBe(32);
  });

  it('higher rated winner gains less', () => {
    const result = calculateDuelElo(1200, 1000, 10, 10);
    // K = 32, E_winner ≈ 0.76, delta ≈ 32 * 0.24 ≈ 8
    expect(result.winnerNew).toBeGreaterThan(1200);
    expect(result.winnerNew).toBeLessThan(1210);
    expect(result.loserNew).toBeLessThan(1000);
  });

  it('lower rated winner gains more', () => {
    const result = calculateDuelElo(1000, 1200, 10, 10);
    // K = 32, E_winner ≈ 0.24, delta ≈ 32 * 0.76 ≈ 24
    expect(result.winnerNew).toBeGreaterThan(1020);
    expect(result.loserNew).toBeLessThan(1180);
  });
});

describe('calculateFFAElo', () => {
  it('4 equal ratings: first gains +32, last loses -32', () => {
    const ratings = [1000, 1000, 1000, 1000];
    const games = [0, 0, 0, 0];
    const placements = [1, 2, 3, 4];
    const result = calculateFFAElo(ratings, games, placements);
    // K = 64, K' = 64/3 ≈ 21.33
    // For first place: beats 3 players, each E=0.5, S=1, delta per pair = 21.33*0.5 = 10.67, total ≈ 32
    expect(result.newRatings[0]).toBe(1032);
    expect(result.newRatings[3]).toBe(968);
    expect(result.deltas[0]).toBe(32);
    expect(result.deltas[3]).toBe(-32);
  });

  it('4 equal ratings with tie for middle: tied players get 0', () => {
    const ratings = [1000, 1000, 1000, 1000];
    const games = [0, 0, 0, 0];
    const placements = [1, 2, 2, 4]; // tie for 2nd/3rd
    const result = calculateFFAElo(ratings, games, placements);
    // First: beats 3, gains +32
    // Last: loses to 3, loses -32
    // Middle two: each beats 1 (the last), loses to 1 (the first), ties with each other
    // S = 1 vs last, 0 vs first, 0.5 vs each other
    // delta = 21.33*(1-0.5) + 21.33*(0-0.5) + 21.33*(0.5-0.5) = 0
    expect(result.deltas[0]).toBe(32);
    expect(result.deltas[3]).toBe(-32);
    expect(result.deltas[1]).toBe(0);
    expect(result.deltas[2]).toBe(0);
  });

  it('different ratings: upsets give bigger swings', () => {
    const ratings = [800, 1000, 1200, 1400];
    const games = [10, 10, 10, 10];
    const placements = [4, 3, 2, 1]; // index 0 got 4th (last), index 3 got 1st (first)
    const result = calculateFFAElo(ratings, games, placements);
    // 1400 rated player got 1st place: gains a little (expected)
    expect(result.deltas[3]).toBeGreaterThan(0);
    // 800 rated player got 4th place: loses a little (expected)
    expect(result.deltas[0]).toBeLessThan(0);

    // Now test actual upset: lowest rated wins
    const upsetPlacements = [1, 2, 3, 4]; // index 0 (800) got 1st, index 3 (1400) got 4th
    const upsetResult = calculateFFAElo(ratings, games, upsetPlacements);
    expect(upsetResult.deltas[0]).toBeGreaterThan(20); // 800-rated 1st place: big gain
    expect(upsetResult.deltas[3]).toBeLessThan(-20); // 1400-rated 4th place: big loss
  });
});
