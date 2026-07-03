// Applies + persists rating changes after a ranked match. Pure math lives in
// shared/elo.ts; this file only touches the DB.

import { duelElo, ffaElo, type GameMode } from "../../shared/src/index.js";
import { getRating, saveRating } from "./db/queries.js";

export interface EloResult {
  playerId: string;
  before: number;
  after: number;
}

/**
 * placements: 1..n per player (duel: winner 1, loser 2).
 * Returns before/after per player and persists games/wins/peak.
 */
export function applyRankedResult(
  mode: GameMode,
  entrants: { playerId: string; placement: number }[]
): EloResult[] {
  const ratings = entrants.map((e) => ({ e, r: getRating(e.playerId, mode) }));

  let deltas: number[];
  if (mode === "duel" && entrants.length === 2) {
    const [a, b] = ratings;
    const [dA, dB] = duelElo(
      a.r.rating,
      b.r.rating,
      a.e.placement < b.e.placement,
      a.r.games,
      b.r.games
    );
    deltas = [dA, dB];
  } else {
    deltas = ffaElo(
      ratings.map(({ e, r }) => ({ rating: r.rating, games: r.games, placement: e.placement }))
    );
  }

  return ratings.map(({ e, r }, i) => {
    const after = r.rating + deltas[i];
    const won = e.placement === 1;
    saveRating(e.playerId, mode, {
      rating: after,
      games: r.games + 1,
      wins: r.wins + (won ? 1 : 0),
      peak: Math.max(r.peak, after),
    });
    return { playerId: e.playerId, before: r.rating, after };
  });
}
