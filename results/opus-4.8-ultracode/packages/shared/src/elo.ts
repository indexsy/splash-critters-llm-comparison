/**
 * Elo rating math — pure functions, unit-tested with fixtures.
 * Duel = standard Elo. FFA = pairwise Elo over final placements.
 */

import { effectiveKFactor } from './config';

/** Expected score for A vs B under the logistic Elo model. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface DuelDelta {
  winner: number;
  loser: number;
}

/** Rating deltas for a 1v1 result (winner won, no draws at first-to-3). */
export function duelDeltas(
  winnerRating: number,
  loserRating: number,
  winnerGames: number,
  loserGames: number,
): DuelDelta {
  const kW = effectiveKFactor(winnerGames);
  const kL = effectiveKFactor(loserGames);
  const eW = expectedScore(winnerRating, loserRating);
  const eL = expectedScore(loserRating, winnerRating);
  return {
    winner: Math.round(kW * (1 - eW)),
    loser: Math.round(kL * (0 - eL)),
  };
}

export interface FfaEntry {
  rating: number;
  games: number;
  /** final placement, 1 = best; ties share the same number */
  placement: number;
}

/**
 * Pairwise FFA Elo. Each player's delta is the sum over the other players of
 * K'(S - E) with K' = effectiveK(games)/ (n-1). Score S: win 1 / tie 0.5 / loss 0.
 * Returns deltas in the same order as the input entries.
 */
export function ffaDeltas(entries: FfaEntry[]): number[] {
  const n = entries.length;
  const deltas = new Array<number>(n).fill(0);
  if (n < 2) return deltas;
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    const a = entries[i];
    const k = effectiveKFactor(a.games) / denom;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = entries[j];
      let s: number;
      if (a.placement < b.placement) s = 1;
      else if (a.placement > b.placement) s = 0;
      else s = 0.5;
      sum += k * (s - expectedScore(a.rating, b.rating));
    }
    deltas[i] = Math.round(sum);
  }
  return deltas;
}

/**
 * Derive placements from per-player round wins (primary, desc) and soaks
 * (tiebreak, desc). Unresolved ties (equal on both) share a placement number.
 * Returns placement per input index (1 = best).
 */
export function placementsFromResults(
  results: { roundWins: number; soaks: number }[],
): number[] {
  const order = results
    .map((r, i) => ({ i, roundWins: r.roundWins, soaks: r.soaks }))
    .sort((a, b) => b.roundWins - a.roundWins || b.soaks - a.soaks);

  const placement = new Array<number>(results.length).fill(1);
  let currentPlace = 1;
  for (let rank = 0; rank < order.length; rank++) {
    if (rank > 0) {
      const prev = order[rank - 1];
      const cur = order[rank];
      const tied = prev.roundWins === cur.roundWins && prev.soaks === cur.soaks;
      if (!tied) currentPlace = rank + 1;
    }
    placement[order[rank].i] = currentPlace;
  }
  return placement;
}
