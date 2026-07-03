import { CONFIG } from "./config.js";

// Pure Elo math. Persistence lives server-side; this file is fully unit-tested.

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** K = 64 for a player's first 10 games in a mode, then 32. */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < CONFIG.ELO_NEW_GAME_COUNT ? CONFIG.ELO_K_NEW : CONFIG.ELO_K;
}

/**
 * Standard 1v1 Elo. score = 1 win, 0 loss (first-to-3 duels cannot draw).
 * Returns integer rating deltas [deltaA, deltaB].
 */
export function duelElo(
  ratingA: number,
  ratingB: number,
  aWon: boolean,
  gamesA: number,
  gamesB: number
): [number, number] {
  const sA = aWon ? 1 : 0;
  const dA = Math.round(kFactor(gamesA) * (sA - expectedScore(ratingA, ratingB)));
  const dB = Math.round(kFactor(gamesB) * (1 - sA - expectedScore(ratingB, ratingA)));
  return [dA, dB];
}

export interface FfaEntrant {
  rating: number;
  games: number;
  /** Final placement 1..4 (by round wins, tiebreak total soaks; unresolved ties share placement). */
  placement: number;
}

/**
 * Pairwise Elo for 4-player FFA: each pair scores win 1 / tie 0.5 / loss 0 by
 * placement; a player's delta is the sum over the other three opponents of
 * K'(S - E) with K' = K/3. Returns integer deltas in entrant order.
 */
export function ffaElo(entrants: FfaEntrant[]): number[] {
  return entrants.map((me, i) => {
    const kPrime = kFactor(me.games) / (entrants.length - 1);
    let delta = 0;
    entrants.forEach((opp, j) => {
      if (i === j) return;
      const score = me.placement < opp.placement ? 1 : me.placement === opp.placement ? 0.5 : 0;
      delta += kPrime * (score - expectedScore(me.rating, opp.rating));
    });
    return Math.round(delta);
  });
}

/**
 * Final FFA placements from round wins with total-soaks tiebreak; unresolved
 * ties share the better placement (standard competition ranking: 1,2,2,4).
 */
export function ffaPlacements(results: { roundsWon: number; soaks: number }[]): number[] {
  const order = results
    .map((r, slot) => ({ ...r, slot }))
    .sort((a, b) => b.roundsWon - a.roundsWon || b.soaks - a.soaks);
  const placements = new Array<number>(results.length).fill(0);
  order.forEach((entry, i) => {
    if (i > 0 && entry.roundsWon === order[i - 1].roundsWon && entry.soaks === order[i - 1].soaks) {
      placements[entry.slot] = placements[order[i - 1].slot]; // shared placement
    } else {
      placements[entry.slot] = i + 1;
    }
  });
  return placements;
}
