import { CONFIG } from './config.js';

export interface RatingState {
  rating: number;
  games: number;
}

function kFor(games: number): number {
  return games < CONFIG.ELO_NEW_GAMES ? CONFIG.ELO_K_NEW : CONFIG.ELO_K;
}

function expected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** Duel: winnerId gets 1, loser 0. Returns deltas keyed by playerId. */
export function duelDelta(
  winnerId: string,
  loserId: string,
  ratings: Record<string, RatingState>,
): Record<string, number> {
  const w = ratings[winnerId];
  const l = ratings[loserId];
  const kw = kFor(w.games);
  const kl = kFor(l.games);
  const ew = expected(w.rating, l.rating);
  const el = expected(l.rating, w.rating);
  return {
    [winnerId]: Math.round(kw * (1 - ew)),
    [loserId]: Math.round(kl * (0 - el)),
  };
}

/**
 * FFA pairwise Elo. placements: array of playerIds in finish order (index 0 = 1st).
 * Ties: pass groups — players in the same sub-array share placement.
 */
export function ffaDeltas(
  groups: string[][],
  ratings: Record<string, RatingState>,
): Record<string, number> {
  // rank index per player (lower = better)
  const rankOf: Record<string, number> = {};
  groups.forEach((g, gi) => {
    for (const pid of g) rankOf[pid] = gi;
  });
  const ids = Object.keys(rankOf);
  const deltas: Record<string, number> = {};
  for (const pid of ids) deltas[pid] = 0;
  for (const pid of ids) {
    const k = kFor(ratings[pid].games) / 3; // K' = K/3
    let d = 0;
    for (const opp of ids) {
      if (opp === pid) continue;
      const s = rankOf[pid] < rankOf[opp] ? 1 : rankOf[pid] === rankOf[opp] ? 0.5 : 0;
      const e = expected(ratings[pid].rating, ratings[opp].rating);
      d += k * (s - e);
    }
    deltas[pid] = Math.round(d);
  }
  return deltas;
}

export function applyDeltas(
  ratings: Record<string, RatingState>,
  deltas: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pid of Object.keys(deltas)) {
    out[pid] = ratings[pid].rating + deltas[pid];
  }
  return out;
}
