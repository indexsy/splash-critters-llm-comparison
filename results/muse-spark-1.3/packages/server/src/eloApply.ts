import { CONFIG, duelDelta, ffaDeltas } from '@splash/shared';
import { db, getRatings, updateRating, addXp } from './db/db.js';
import type { Room } from './rooms.js';

export interface MatchResult {
  placements: { playerId: string; nickname: string; placement: number; soaks: number; roundsWon: number; ratingBefore?: number; ratingAfter?: number; xpEarned: number }[];
  ratingDeltas?: Record<string, number>;
}

export function placementOrder(room: Room): { playerId: string; nickname: string; roundsWon: number; soaks: number }[] {
  const game = room.game!;
  // soaks: accumulate from state? killers incremented per-round player objects; sum across rounds via totalSoaksLive stored on room? Fallback: current round soaks + totals.
  // We track totals in net layer; here read game.totalSoaksLive if present.
  const live = (game as unknown as { soaksLive?: Record<string, number> }).soaksLive ?? {};
  const rows = room.slots
    .filter((s) => s.kind === 'human' || s.kind === 'bot')
    .map((s) => {
      const pid = s.kind === 'human' ? s.playerId! : `bot-${room.code}-${s.slot}`;
      return {
        playerId: pid,
        nickname: s.nickname ?? pid,
        roundsWon: game.scores[pid] ?? 0,
        soaks: live[pid] ?? game.state?.players.find((p) => p.id === pid)?.soaks ?? 0,
      };
    });
  rows.sort((a, b) => b.roundsWon - a.roundsWon || b.soaks - a.soaks);
  return rows;
}

export function finalizeMatch(room: Room): MatchResult {
  const game = room.game!;
  const order = placementOrder(room);
  const humanOrder = order.filter((r) => !r.playerId.startsWith('bot-'));
  const matchId = game.matchId;
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO matches (id, mode, ranked, started_at, ended_at) VALUES (?,?,?,?,?)').run(
    matchId, game.mode, room.ranked ? 1 : 0, game.startedAt, now,
  );

  let ratingDeltas: Record<string, number> | undefined;
  if (room.ranked && humanOrder.length >= 2) {
    const ratings: Record<string, { rating: number; games: number }> = {};
    const before: Record<string, number> = {};
    for (const h of humanOrder) {
      const r = getRatings(h.playerId)[game.mode];
      ratings[h.playerId] = { rating: r.rating, games: r.games };
      before[h.playerId] = r.rating;
    }
    if (game.mode === 'duel' && humanOrder.length === 2) {
      ratingDeltas = duelDelta(humanOrder[0].playerId, humanOrder[1].playerId, ratings);
    } else {
      // groups by placement (ties share group)
      const groups: string[][] = [];
      let lastKey = '';
      for (const h of humanOrder) {
        const key = `${h.roundsWon}:${h.soaks}`;
        if (key !== lastKey) {
          groups.push([]);
          lastKey = key;
        }
        groups[groups.length - 1].push(h.playerId);
      }
      ratingDeltas = ffaDeltas(groups, ratings);
    }
    // persist
    humanOrder.forEach((h, idx) => {
      const after = before[h.playerId] + ratingDeltas![h.playerId];
      updateRating(h.playerId, game.mode, after, idx === 0);
    });
  }

  const placements = order.map((r, idx) => {
    const isBot = r.playerId.startsWith('bot-');
    const placement = idx + 1;
    let xpEarned = 0;
    let ratingBefore: number | undefined;
    let ratingAfter: number | undefined;
    if (!isBot) {
      xpEarned = CONFIG.XP_PARTICIPATION + (idx === 0 ? CONFIG.XP_PER_WIN * 2 : idx === 1 ? CONFIG.XP_PER_WIN : 0) + r.soaks * CONFIG.XP_PER_SOAK + (game.totalCastles[r.playerId] ?? 0) * CONFIG.XP_PER_CASTLE;
      const { xp: _xp, level: _lv } = addXp(r.playerId, xpEarned);
      void _xp;
      void _lv;
      if (ratingDeltas && ratingDeltas[r.playerId] !== undefined) {
        const rr = getRatings(r.playerId)[game.mode];
        ratingAfter = rr.rating;
        ratingBefore = ratingAfter - ratingDeltas[r.playerId];
      }
      db.prepare('INSERT OR REPLACE INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned) VALUES (?,?,?,?,?,?,?,?)').run(
        matchId, r.playerId, placement, r.soaks, r.roundsWon, ratingBefore ?? null, ratingAfter ?? null, xpEarned,
      );
    }
    return { ...r, placement, ratingBefore, ratingAfter, xpEarned };
  });

  return { placements, ratingDeltas };
}
