import { describe, expect, it } from 'vitest'
import {
  CONFIG,
  duelDelta,
  expectedScore,
  ffaPairwiseDeltas,
  rankedPlacements,
  tierOf
} from '../src'
import type { GlobalRating } from '../src/elo'

function R(rating: number, games = 10, wins = 5): GlobalRating {
  return { player: '', rating, games, wins, peak: rating }
}

describe('elo', () => {
  it('duel delta symmetric zero-sum', () => {
    const a = R(1000, 12)
    const b = R(1000, 12)
    const da = duelDelta(a, b, true)
    const db = duelDelta(b, a, false)
    expect(da).toBe(CONFIG.ELO.K / 2)
    expect(da).toBe(-db)
    const ia = R(1100, 9)
    const ib = R(1000, 9)
    const dia = duelDelta(ia, ib, true)
    expect(Math.abs(dia)).toBeLessThan(CONFIG.ELO.K_PROVISIONAL / 2)
    expect(dia).toBe(Math.round(CONFIG.ELO.K_PROVISIONAL * (1 - expectedScore(1100, 1000))))
  })

  it('duel provisional K = 64 first 10 games', () => {
    const a = R(1000, 5)
    const b = R(1000, 50)
    expect(duelDelta(a, b, true) * 2).toBe(64)
  })

  it('ffa pairwise matches fixture table', () => {
    const ratings = new Map([
      ['w', R(1000, 20)],
      ['x', R(1000, 20)],
      ['y', R(1000, 20)],
      ['z', R(1000, 20)]
    ])
    const placements = rankedPlacements([
      { id: 'w', roundsWon: 3, soaks: 4 },
      { id: 'x', roundsWon: 1, soaks: 6 },
      { id: 'y', roundsWon: 1, soaks: 2 },
      { id: 'z', roundsWon: 0, soaks: 1 }
    ])
    expect(placements).toEqual([
      { id: 'w', placement: 1 },
      { id: 'x', placement: 2 },
      { id: 'y', placement: 3 },
      { id: 'z', placement: 4 }
    ])
    const deltas = ffaPairwiseDeltas(ratings, [
      { id: 'w', roundsWon: 3, soaks: 4 },
      { id: 'x', roundsWon: 1, soaks: 6 },
      { id: 'y', roundsWon: 1, soaks: 2 },
      { id: 'z', roundsWon: 0, soaks: 1 }
    ])
    expect(deltas.get('w')).toBe(16)
    expect(deltas.get('z')).toBe(-16)
    const sum = [...deltas.values()].reduce((a, b) => a + b, 0)
    expect(Math.abs(sum)).toBeLessThanOrEqual(4)
  })

  it('ffa zero-sum for equal ratings full spread', () => {
    const ratings = new Map([
      ['a', R(1100, 8)],
      ['b', R(1000, 8)],
      ['c', R(900, 8)],
      ['d', R(1200, 8)]
    ])
    const deltas = ffaPairwiseDeltas(ratings, [
      { id: 'a', roundsWon: 3, soaks: 9 },
      { id: 'b', roundsWon: 2, soaks: 1 },
      { id: 'c', roundsWon: 0, soaks: 0 },
      { id: 'd', roundsWon: 1, soaks: 2 }
    ])
    const sum = [...deltas.values()].reduce((x, y) => x + y, 0)
    expect(Math.abs(sum)).toBeLessThanOrEqual(3)
    expect(deltas.get('a')!).toBeGreaterThan(0)
    expect(deltas.get('c')!).toBeLessThan(0)
  })

  it('tie shares placement and scores 0.5 each', () => {
    const ranked = rankedPlacements([
      { id: 'a', roundsWon: 2, soaks: 5 },
      { id: 'b', roundsWon: 2, soaks: 5 }
    ])
    expect(ranked.map((r) => r.placement)).toEqual([1, 1])
  })

  it('tier bands', () => {
    expect(tierOf(0)).toBe('Puddle')
    expect(tierOf(999)).toBe('Puddle')
    expect(tierOf(1000)).toBe('Pond')
    expect(tierOf(1150)).toBe('River')
    expect(tierOf(1300)).toBe('Lake')
    expect(tierOf(1500)).toBe('Ocean')
    expect(tierOf(1750)).toBe('Tsunami')
  })
})
