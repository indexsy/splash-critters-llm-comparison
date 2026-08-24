import { CONFIG, tierFor } from "./config";
import type { GameMode } from "./types";

/** Expected score for player A vs opponent(s). */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function kFactor(gamesPlayedInMode: number): number {
  return gamesPlayedInMode < CONFIG.freshGamesThreshold ? CONFIG.eloKFresh : CONFIG.eloKNormal;
}

export interface EloResult {
  before: number;
  after: number;
  delta: number;
  tier: string;
}

/**
 * Duel: standard Elo. scores = [1/0] per player.
 */
export function applyDuelElo(
  ratings: Array<{ games: number; rating: number }>,
  scores: number[],
): EloResult[] {
  const Ks = ratings.map((r) => kFactor(r.games));
  const results: EloResult[] = [];
  for (let i = 0; i < ratings.length; i++) {
    const j = i === 0 ? 1 : 0;
    const expected = expectedScore(ratings[i]!.rating, ratings[j]!.rating);
    const delta = Math.round(Ks[i]! * (scores[i]! - expected));
    const after = ratings[i]!.rating + delta;
    results.push({ before: ratings[i]!.rating, after, delta, tier: tierFor(after) });
  }
  return results;
}

/**
 * FFA (4p): pairwise Elo over final placements.
 * placement 1 = best. Each pair contributes S (1 / 0.5 / 0) with K' = K/3.
 */
export function applyFfaElo(
  entrants: Array<{ games: number; rating: number; placement: number }>,
): EloResult[] {
  const n = entrants.length;
  const deltas = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const Ki = kFactor(entrants[i]!.games) / 3;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const S =
        entrants[i]!.placement < entrants[j]!.placement ? 1 : entrants[i]!.placement === entrants[j]!.placement ? 0.5 : 0;
      const E = expectedScore(entrants[i]!.rating, entrants[j]!.rating);
      deltas[i]! += Ki * (S - E);
    }
  }
  return entrants.map((e, i) => {
    const after = e.rating + Math.round(deltas[i]!);
    return { before: e.rating, after, delta: Math.round(deltas[i]!), tier: tierFor(after) };
  });
}

/** Compute placements from match stats (round wins desc, then soaks desc; ties share placement). */
export function computePlacements(
  stats: Array<{ entityId: string; roundsWon: number; soaks: number }>,
): Array<{ entityId: string; placement: number }> {
  const sorted = [...stats].sort((a, b) => b.roundsWon - a.roundsWon || b.soaks - a.soaks);
  const out: Array<{ entityId: string; placement: number }> = [];
  let lastKey: string | null = null;
  let lastPlacement = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const key = `${s.roundsWon}:${s.soaks}`;
    const placement = key === lastKey ? lastPlacement : i + 1;
    out.push({ entityId: s.entityId, placement });
    lastKey = key;
    lastPlacement = placement;
  }
  return out;
}
