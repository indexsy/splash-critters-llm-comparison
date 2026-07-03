// Match finalization: placements, XP, Elo persistence, fun awards.

import {
  CONFIG,
  ffaPlacements,
  type MatchEndAwards,
  type MatchEndPlayer,
} from "../../shared/src/index.js";
import { addXp, buildProfile, insertMatch, insertMatchPlayer } from "./db/queries.js";
import { applyRankedResult } from "./elo.js";
import type { Match, Seat } from "./gameLoop.js";

function computePlacements(match: Match): number[] {
  const seats = match.seats;
  if (match.mode === "duel") {
    const [a, b] = seats;
    if (a.forfeited !== b.forfeited) return a.forfeited ? [2, 1] : [1, 2];
    return a.roundsWon >= b.roundsWon ? [1, 2] : [2, 1];
  }
  // FFA: rank active seats by round wins / soak tiebreak; forfeiters take last.
  const active = seats.filter((s) => !s.forfeited);
  const forfeited = seats.filter((s) => s.forfeited);
  const activePlacements = ffaPlacements(
    active.map((s) => ({ roundsWon: s.roundsWon, soaks: s.totalSoaks }))
  );
  const placements = new Array<number>(seats.length).fill(seats.length);
  active.forEach((s, i) => (placements[s.slot] = activePlacements[i]));
  forfeited.forEach((s) => (placements[s.slot] = seats.length));
  return placements;
}

function xpFor(seat: Seat, placement: number): number {
  return (
    CONFIG.XP_PARTICIPATION +
    (CONFIG.XP_PLACEMENT[placement - 1] ?? 0) +
    seat.totalSoaks * CONFIG.XP_PER_SOAK +
    seat.totalCastles * CONFIG.XP_PER_CASTLE
  );
}

export function finalizeMatch(match: Match): { players: MatchEndPlayer[]; awards: MatchEndAwards } {
  const placements = computePlacements(match);
  const humans = match.seats.filter((s) => !s.isBot || s.convertedToBot);

  // Elo first (ranked only, humans only — ranked never contains bots).
  const eloByPlayer = new Map<string, { before: number; after: number }>();
  if (match.ranked) {
    const results = applyRankedResult(
      match.mode,
      humans.map((s) => ({ playerId: s.playerId, placement: placements[s.slot] }))
    );
    for (const r of results) eloByPlayer.set(r.playerId, r);
  }

  const matchId = insertMatch(match.mode, match.ranked, match.startedAt);

  const players: MatchEndPlayer[] = match.seats.map((seat) => {
    const placement = placements[seat.slot];
    const isRealHuman = !seat.isBot || seat.convertedToBot;
    const xpEarned = isRealHuman ? xpFor(seat, placement) : 0;
    const elo = eloByPlayer.get(seat.playerId);
    if (isRealHuman) {
      addXp(seat.playerId, xpEarned);
      insertMatchPlayer(
        matchId,
        seat.playerId,
        placement,
        seat.totalSoaks,
        seat.roundsWon,
        elo?.before ?? null,
        elo?.after ?? null,
        xpEarned
      );
    }
    return {
      slot: seat.slot,
      playerId: seat.playerId,
      nickname: seat.nickname,
      placement,
      roundsWon: seat.roundsWon,
      soaks: seat.totalSoaks,
      revengeSoaks: seat.totalRevengeSoaks,
      castles: seat.totalCastles,
      biggestChain: seat.biggestChain,
      survivedTicks: seat.survivedTicks,
      xpEarned,
      ratingBefore: elo?.before,
      ratingAfter: elo?.after,
    };
  });

  // Push fresh profiles (xp/level/unlock changes) to connected humans.
  for (const seat of humans) {
    const profile = buildProfile(seat.playerId);
    if (profile) seat.conn?.send({ t: "profile_update", profile });
  }

  const bestBy = (f: (p: MatchEndPlayer) => number): number | undefined => {
    let best: MatchEndPlayer | undefined;
    for (const p of players) if (f(p) > 0 && (!best || f(p) > f(best))) best = p;
    return best?.slot;
  };

  const awards: MatchEndAwards = {
    mostSoaks: bestBy((p) => p.soaks),
    castleCrusher: bestBy((p) => p.castles),
    longestSurvivor: bestBy((p) => p.survivedTicks),
    biggestChain: bestBy((p) => (p.biggestChain >= 2 ? p.biggestChain : 0)),
  };

  return { players, awards };
}
