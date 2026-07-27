/**
 * Rating maths. Pure functions only - the server persists the results, this
 * module never touches storage.
 *
 * Duel is textbook Elo. Free-for-all uses pairwise Elo: every player is scored
 * against each of the other three and the deltas are summed with a reduced
 * K so a 4-player match moves ratings on the same scale as a 1v1.
 */

import { CONFIG } from './config.js';

export interface EloEntry {
  /** Rating before the match. */
  rating: number;
  /** Games already played in this mode before the match. */
  games: number;
  /** 1 = best. Tied players share the better placement (1, 2, 2, 4). */
  placement: number;
}

export interface PlacementInput {
  playerId: string;
  roundsWon: number;
  soaks: number;
}

/** Probability that `a` beats `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** K is boosted while a player is still provisional in that mode. */
export function kFactor(games: number): number {
  return games < CONFIG.ELO_PROVISIONAL_GAMES ? CONFIG.ELO_K_PROVISIONAL : CONFIG.ELO_K;
}

/** Round half away from zero, so a duel's two deltas always cancel exactly. */
function symmetricRound(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Standard competition ranking: sort by round wins, break ties on total soaks,
 * and let genuinely tied players share a placement.
 */
export function rankPlacements(results: readonly PlacementInput[]): Map<string, number> {
  const sorted = [...results].sort((a, b) => {
    if (b.roundsWon !== a.roundsWon) return b.roundsWon - a.roundsWon;
    if (b.soaks !== a.soaks) return b.soaks - a.soaks;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  });

  const placements = new Map<string, number>();
  let placement = 1;
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const tied = prev !== undefined && prev.roundsWon === cur.roundsWon && prev.soaks === cur.soaks;
    if (!tied) placement = i + 1;
    placements.set(cur.playerId, placement);
  }
  return placements;
}

/** Pairwise score: 1 for a better placement, 0.5 for a tie, 0 for worse. */
function pairScore(placementA: number, placementB: number): number {
  if (placementA < placementB) return 1;
  if (placementA > placementB) return 0;
  return 0.5;
}

/**
 * Rating deltas for one match. Works for any player count:
 * - 2 players: classic Elo at full K.
 * - n > 2: pairwise Elo at K / (n - 1), which is exactly K/3 for a 4-player FFA.
 *
 * All expectations use pre-match ratings, so ordering never affects the result.
 */
export function computeEloDeltas(entries: readonly EloEntry[]): number[] {
  const n = entries.length;
  if (n < 2) return entries.map(() => 0);

  const divisor = n === 2 ? 1 : n - 1;

  return entries.map((self, i) => {
    const k = kFactor(self.games) / divisor;
    let delta = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const other = entries[j];
      const s = pairScore(self.placement, other.placement);
      const e = expectedScore(self.rating, other.rating);
      delta += k * (s - e);
    }
    return symmetricRound(delta);
  });
}

/** Convenience wrapper for a decided 1v1. */
export function duelDeltas(
  winner: Omit<EloEntry, 'placement'>,
  loser: Omit<EloEntry, 'placement'>,
): { winner: number; loser: number } {
  const [w, l] = computeEloDeltas([
    { ...winner, placement: 1 },
    { ...loser, placement: 2 },
  ]);
  return { winner: w, loser: l };
}

/** Ratings never drop below zero, and `peak` only ever climbs. */
export function applyDelta(rating: number, delta: number): number {
  return Math.max(0, rating + delta);
}
