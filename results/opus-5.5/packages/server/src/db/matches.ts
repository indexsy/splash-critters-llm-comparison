// Typed queries for finished matches and their (human) participants.
import type { Mode, RecentMatch } from '@splash/shared';
import type { Db } from './connection';
import { preparedStatements, toSqlBool, toSqlLimit } from './prepared';

export interface MatchRecord {
  id: string;
  mode: Mode;
  ranked: boolean;
  startedAt: number;
  endedAt: number;
  /** Participants including bots (bots themselves are never persisted). */
  playerCount: number;
}

export interface MatchPlayerRecord {
  matchId: string;
  playerId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  /** Null for unranked matches. */
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}

interface RecentMatchRow {
  match_id: string;
  mode: Mode;
  ranked: number;
  ended_at: number;
  player_count: number;
  placement: number;
  soaks: number;
  rounds_won: number;
  rating_before: number | null;
  rating_after: number | null;
  xp_earned: number;
}

const statements = preparedStatements((db: Db) => ({
  insertMatch: db.prepare<[string, Mode, number, number, number, number]>(
    'INSERT INTO matches (id, mode, ranked, started_at, ended_at, player_count) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  insertMatchPlayer: db.prepare<MatchPlayerRecord>(
    `INSERT INTO match_players
       (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
     VALUES (@matchId, @playerId, @placement, @soaks, @roundsWon, @ratingBefore, @ratingAfter, @xpEarned)`,
  ),
  recentForPlayer: db.prepare<[string, number], RecentMatchRow>(
    `SELECT m.id AS match_id, m.mode, m.ranked, m.ended_at, m.player_count,
            mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after, mp.xp_earned
     FROM match_players mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.player_id = ?
     ORDER BY m.ended_at DESC, m.id DESC
     LIMIT ?`,
  ),
}));

/** Inserts the match header row. Throws if the id already exists (a match is persisted once). */
export function insertMatch(db: Db, match: MatchRecord): void {
  statements(db).insertMatch.run(match.id, match.mode, toSqlBool(match.ranked), match.startedAt, match.endedAt, match.playerCount);
}

export function insertMatchPlayer(db: Db, row: MatchPlayerRecord): void {
  statements(db).insertMatchPlayer.run(row);
}

/** A player's most recent matches, newest first. */
export function getRecentMatches(db: Db, playerId: string, limit: number): RecentMatch[] {
  return statements(db)
    .recentForPlayer.all(playerId, toSqlLimit(limit))
    .map((row) => ({
      matchId: row.match_id,
      mode: row.mode,
      ranked: row.ranked === 1,
      endedAt: row.ended_at,
      placement: row.placement,
      players: row.player_count,
      soaks: row.soaks,
      roundsWon: row.rounds_won,
      ratingBefore: row.rating_before,
      ratingAfter: row.rating_after,
      xpEarned: row.xp_earned,
    }));
}
