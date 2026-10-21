import {
  CONFIG,
  computeXp,
  duelElo,
  ffaElo,
  placementsFromStandings,
  tierName,
  type Mode,
} from '@splash-critters/shared';
import Database from 'better-sqlite3';
import {
  addXp,
  createMatch,
  finishMatch,
  getRating,
  saveMatchPlayers,
  updateRating,
} from './db/index.js';
import type { RoomStandings, MatchEndPayload } from './rooms.js';

/**
 * Applies the end of a match: persists the match row, the per player stats,
 * the rating changes (ranked only) and the XP awards.
 */
export function applyMatchResults(
  db: Database.Database,
  matchId: string,
  mode: Mode,
  ranked: boolean,
  standings: RoomStandings[],
  startedAt: number,
): MatchEndPayload {
  const placements = placementsFromStandings(
    standings.map((s) => ({ roundWins: s.roundWins, soaks: s.soaks })),
  );

  const entries = standings.map((s, i) => ({
    slot: s.slotIndex,
    playerId: s.playerId,
    nickname: s.nickname,
    tag: s.tag,
    placement: placements[i],
    roundWins: s.roundWins,
    soaks: s.soaks,
    castlesWashed: s.castlesWashed,
    biggestChain: s.biggestChain,
    survivedTicks: s.survivedTicks,
  }));

  const ratingDeltas: MatchEndPayload['ratingDeltas'] = [];
  const xp: MatchEndPayload['xp'] = [];

  const rated = ranked
    ? entries
        .map((entry) => {
          const slot = entry.playerId;
          if (!slot) return null;
          const rating = getRating(db, slot, mode);
          return { entry, rating };
        })
        .filter((v): v is { entry: (typeof entries)[number]; rating: ReturnType<typeof getRating> } => v !== null)
    : [];

  let changes = new Map<string, { before: number; after: number }>();
  if (mode === 'duel' && rated.length === 2) {
    const [a, b] = rated;
    const [ca, cb] = duelElo(
      { rating: a.rating.rating, games: a.rating.games },
      { rating: b.rating.rating, games: b.rating.games },
      a.entry.placement === 1 ? 1 : 0,
    );
    changes.set(a.entry.playerId!, { before: ca.ratingBefore, after: ca.ratingAfter });
    changes.set(b.entry.playerId!, { before: cb.ratingBefore, after: cb.ratingAfter });
  } else if (mode === 'ffa' && rated.length >= 2) {
    const result = ffaElo(
      rated.map((r) => ({ rating: r.rating.rating, games: r.rating.games })),
      rated.map((r) => r.entry.placement),
    );
    rated.forEach((r, i) => {
      changes.set(r.entry.playerId!, {
        before: result[i].ratingBefore,
        after: result[i].ratingAfter,
      });
    });
  }

  for (const entry of entries) {
    const playerId = entry.playerId;
    if (!playerId) continue;
    const change = changes.get(playerId);
    const before = change?.before ?? getRating(db, playerId, mode).rating;
    const after = change?.after ?? before;
    const tierBefore = tierName(before);
    const tier = tierName(after);
    ratingDeltas.push({
      playerId,
      ratingBefore: before,
      ratingAfter: after,
      delta: after - before,
      tier,
      tierBefore,
    });

    const xpGain = computeXp({
      mode,
      placement: entry.placement,
      soaks: entry.soaks,
      castlesWashed: entry.castlesWashed,
      participants: entries.length,
    });
    const xpResult = addXp(db, playerId, xpGain.total);
    xp.push({
      playerId,
      xp: xpResult.xp,
      totalXp: xpResult.totalXp,
      level: xpResult.level,
      levelUp: xpResult.levelUp,
    });

    if (ranked && change) {
      updateRating(db, playerId, mode, change.after, entry.placement === 1);
    }
  }

  createMatch(db, matchId, mode, ranked, startedAt);
  saveMatchPlayers(
    db,
    matchId,
    entries
      .filter((e) => e.playerId)
      .map((e) => ({
        playerId: e.playerId!,
        placement: e.placement,
        soaks: e.soaks,
        roundsWon: e.roundWins,
        ratingBefore: changes.get(e.playerId!)?.before ?? null,
        ratingAfter: changes.get(e.playerId!)?.after ?? null,
        xpEarned: computeXp({
          mode,
          placement: e.placement,
          soaks: e.soaks,
          castlesWashed: e.castlesWashed,
          participants: entries.length,
        }).total,
      })),
  );
  finishMatch(db, matchId, Date.now());

  const byPlayerId = new Map(entries.map((e) => [e.playerId, e]));
  const nameOf = (playerId: string | null) => {
    if (!playerId) return '';
    const entry = byPlayerId.get(playerId);
    return entry ? entry.nickname : '';
  };
  const best = (pick: (e: (typeof entries)[number]) => number) => {
    let winner: (typeof entries)[number] | null = null;
    for (const e of entries) {
      if (!winner || pick(e) > pick(winner)) winner = e;
    }
    return winner ? nameOf(winner.playerId) : undefined;
  };

  const stats: MatchEndPayload['stats'] = {
    mostSoaks: best((e) => e.soaks),
    castleCrusher: best((e) => e.castlesWashed),
    longestSurvivor: best((e) => e.survivedTicks),
    biggestChain: best((e) => e.biggestChain),
  };

  return { placements: entries, ratingDeltas, xp, stats };
}

export function defaultRoundsToWin(): number {
  return CONFIG.DEFAULT_ROUNDS_TO_WIN;
}
