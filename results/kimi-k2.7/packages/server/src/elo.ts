import type { MatchResult, Mode, Placement } from "@splash/shared";
import { CONFIG, duelDelta, ffaPairwiseDeltas, tierForRating } from "@splash/shared";
import { addXp, applyRatingChanges, getRatings, recordMatch } from "./db/index.js";

export function finalizeRankedMatch(mode: Mode, roundWins: Record<string, number>, soaks: Record<string, number>, matchId: string): MatchResult {
  const ids = Object.keys(roundWins);
  const ratings = getRatings(ids, mode);
  const games: Record<string, number> = {};
  for (const id of ids) games[id] = ratings[id]?.games ?? 0;

  let ratingDeltas: Record<string, number> = {};
  const placements = Object.entries(roundWins)
    .map(([playerId, roundsWon]) => ({ playerId, roundsWon, soaks: soaks[playerId] ?? 0 }))
    .sort((a, b) => {
      if (a.roundsWon !== b.roundsWon) return b.roundsWon - a.roundsWon;
      return b.soaks - a.soaks;
    })
    .map((p, i) => ({ ...p, placement: i + 1 }));

  if (mode === "duel") {
    const [a, b] = placements;
    const scoreA = a.placement === 1 ? 1 : 0;
    const scoreB = b.placement === 1 ? 1 : 0;
    ratingDeltas[a.playerId] = duelDelta(ratings[a.playerId].rating, ratings[b.playerId].rating, scoreA, games[a.playerId]);
    ratingDeltas[b.playerId] = duelDelta(ratings[b.playerId].rating, ratings[a.playerId].rating, scoreB, games[b.playerId]);
  } else {
    const ffaPlacements: Placement[] = placements.map((p) => ({ playerId: p.playerId, roundsWon: p.roundsWon, soaks: p.soaks }));
    ratingDeltas = ffaPairwiseDeltas(
      Object.fromEntries(ids.map((id) => [id, ratings[id].rating])),
      games,
      ffaPlacements
    );
  }

  const winners = placements.filter((p) => p.placement === 1).map((p) => p.playerId);
  applyRatingChanges(mode, ratingDeltas, winners);

  // XP
  const xp: Record<string, number> = {};
  const stats: Record<string, { soaks: number; castles: number; roundsWon: number }> = {};
  for (const p of placements) {
    let x = CONFIG.XP_PARTICIPATION;
    if (winners.includes(p.playerId)) x += CONFIG.XP_WIN;
    x += (soaks[p.playerId] ?? 0) * CONFIG.XP_PER_SOAK;
    x += CONFIG.XP_TOP_PLACEMENT[Math.min(p.placement - 1, CONFIG.XP_TOP_PLACEMENT.length - 1)] ?? 0;
    xp[p.playerId] = x;
    stats[p.playerId] = { soaks: soaks[p.playerId] ?? 0, castles: 0, roundsWon: p.roundsWon };
    addXp(p.playerId, x);
  }

  const result: MatchResult = {
    matchId,
    mode,
    ranked: true,
    placements: placements.map((p) => ({ playerId: p.playerId, placement: p.placement })),
    ratingDeltas,
    xp,
    stats,
  };
  recordMatch(result);
  return result;
}

export { tierForRating };
