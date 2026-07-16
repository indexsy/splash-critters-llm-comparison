import { describe, it, expect } from 'vitest';
import { duelDelta, ffaDeltas, expectedScore, kFactor, applyDelta } from './elo.js';
import { CONFIG } from './config.js';

describe('Elo math', () => {
  it('expected score is 0.5 for equal ratings', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
  });

  it('K is provisional then standard', () => {
    expect(kFactor(0)).toBe(CONFIG.ELO_K_PROVISIONAL);
    expect(kFactor(9)).toBe(CONFIG.ELO_K_PROVISIONAL);
    expect(kFactor(10)).toBe(CONFIG.ELO_K_STANDARD);
  });

  it('duel: winner gains, loser loses (symmetric equal ratings)', () => {
    const dA = duelDelta(1000, 1000, 1, 20);
    const dB = duelDelta(1000, 1000, 0, 20);
    expect(dA).toBe(16); // K=32 * 0.5
    expect(dB).toBe(-16);
    expect(applyDelta(1000, dA)).toBe(1016);
  });

  it('duel: underdog win gains more', () => {
    const underdogWin = duelDelta(900, 1100, 1, 20);
    const favoriteWin = duelDelta(1100, 900, 1, 20);
    expect(underdogWin).toBeGreaterThan(favoriteWin);
  });

  it('FFA pairwise: 1st place gains vs all', () => {
    const players = [
      { id: 'a', rating: 1000, games: 20, placement: 1 },
      { id: 'b', rating: 1000, games: 20, placement: 2 },
      { id: 'c', rating: 1000, games: 20, placement: 3 },
      { id: 'd', rating: 1000, games: 20, placement: 4 },
    ];
    const deltas = ffaDeltas(players);
    // a beat everyone: 3 pairs * K/3 * 0.5 = 3 * (32/3) * 0.5 ≈ 16 each pair → ~48
    expect(deltas['a']).toBeGreaterThan(0);
    expect(deltas['d']).toBeLessThan(0);
    expect(deltas['a']!).toBeGreaterThan(deltas['b']!);
    expect(deltas['b']!).toBeGreaterThan(deltas['c']!);
  });

  it('FFA tied placement shares 0.5', () => {
    const players = [
      { id: 'a', rating: 1000, games: 20, placement: 1 },
      { id: 'b', rating: 1000, games: 20, placement: 1 },
      { id: 'c', rating: 1000, games: 20, placement: 3 },
      { id: 'd', rating: 1000, games: 20, placement: 4 },
    ];
    const deltas = ffaDeltas(players);
    // a vs b is tie → no change between them
    expect(deltas['a']).toBe(deltas['b']);
  });

  it('fixture: exact duel values', () => {
    // Equal 1000, provisional K=64, win → +32
    expect(duelDelta(1000, 1000, 1, 0)).toBe(32);
    expect(duelDelta(1000, 1000, 0, 0)).toBe(-32);
  });
});
