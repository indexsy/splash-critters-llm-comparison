import {
  CONFIG,
  calculateElo,
  type MatchResult,
  type Mode,
  type Placement,
} from "@splash/shared";
import type { Store } from "./db/queries.js";

export function makeResult(
  store: Store,
  matchId: string,
  mode: Mode,
  ranked: boolean,
  placements: Placement[],
): MatchResult {
  const result: MatchResult = {
    matchId,
    mode,
    ranked,
    placements,
    ratingDeltas: {},
    xp: {},
  };
  if (ranked) {
    const players = placements.map((p) => {
      const rating = store
        .profile(p.playerId)!
        .ratings.find((r) => r.mode === mode)!;
      return {
        id: p.playerId,
        rating: rating.rating,
        games: rating.games,
        placement: p.placement,
      };
    });
    const deltas = calculateElo(players);
    for (const p of players)
      result.ratingDeltas[p.id] = {
        before: p.rating,
        after: p.rating + deltas[p.id],
      };
  }
  for (const p of placements)
    if (store.profile(p.playerId))
      result.xp[p.playerId] = p.forfeited
        ? 0
        : CONFIG.XP.participation +
          (CONFIG.XP.placement[p.placement - 1] ?? 10) +
          p.soaks * CONFIG.XP.soak +
          p.castlesWashed * CONFIG.XP.castle;
  return result;
}
