// elo.ts — pure Elo math (spec §5). Unit-tested with fixtures.
//   - Duel: standard two-player Elo.
//   - FFA (4p): pairwise Elo — placement decides pairwise score (1 / 0.5 / 0),
//     each player's delta = Σ over the other 3 of K'(S − E), with K' = K/3.

import { ELO } from "./config.js";

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < ELO.provisionalGames ? ELO.KProvisional : ELO.KNormal;
}

/** Standard two-player Elo. scoreA = 1 win, 0 loss, 0.5 draw. */
export function eloDuel(
  ratingA: number,
  ratingB: number,
  gamesA: number,
  scoreA: number,
): { deltaA: number; deltaB: number; newA: number; newB: number } {
  const kA = kFactor(gamesA);
  const eA = expected(ratingA, ratingB);
  const deltaA = kA * (scoreA - eA);
  const deltaB = -kA * (scoreA - eA); // symmetric K assumption for the pair
  return {
    deltaA: Math.round(deltaA),
    deltaB: Math.round(deltaB),
    newA: Math.round(ratingA + deltaA),
    newB: Math.round(ratingB + deltaB),
  };
}

/** FFA pairwise: given ratings + final placements (1 = best), compute each delta. */
export function eloFFA(
  ratings: number[],
  games: number[],
  placements: number[], // placement[i], 1-based; ties share placement
): number[] {
  const n = ratings.length;
  const deltas = new Array(n).fill(0);
  const ks = ratings.map((_, i) => kFactor(games[i]) / (n - 1)); // K' = K/3
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const e = expected(ratings[i], ratings[j]);
      // pairwise score from placement: better placement = win
      let s: number;
      if (placements[i] < placements[j]) s = 1;
      else if (placements[i] > placements[j]) s = 0;
      else s = 0.5;
      deltas[i] += ks[i] * (s - e);
    }
  }
  return deltas.map((d) => Math.round(d));
}

export function expected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}
