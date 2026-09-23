// Typed queries for the ratings table (one row per player per mode, created on the first ranked game).
import { CONFIG, tierFor } from '@splash/shared';
import type { LeaderboardEntry, Mode, RatingInfo } from '@splash/shared';
import type { Db } from './connection';
import { storedAnimal } from './players';
import { preparedStatements, toSqlLimit } from './prepared';

/** A player's standing in one mode. */
export interface RatingRecord {
  playerId: string;
  mode: Mode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

interface RatingRow {
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

interface LeaderboardRow extends RatingRow {
  player_id: string;
  nickname: string;
  tag: string;
  selected_animal: string;
}

const statements = preparedStatements((db: Db) => ({
  get: db.prepare<[string, Mode], RatingRow>('SELECT rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?'),
  upsert: db.prepare<RatingRecord>(
    `INSERT INTO ratings (player_id, mode, rating, games, wins, peak)
     VALUES (@playerId, @mode, @rating, @games, @wins, @peak)
     ON CONFLICT (player_id, mode) DO UPDATE SET
       rating = excluded.rating,
       games  = excluded.games,
       wins   = excluded.wins,
       peak   = MAX(ratings.peak, excluded.peak)`,
  ),
  leaderboard: db.prepare<[Mode, number], LeaderboardRow>(
    `SELECT r.player_id, r.rating, r.games, r.wins, r.peak, p.nickname, p.tag, p.selected_animal
     FROM ratings r JOIN players p ON p.id = r.player_id
     WHERE r.mode = ? AND r.games > 0
     ORDER BY r.rating DESC, r.games DESC, p.created_at ASC, r.player_id ASC
     LIMIT ?`,
  ),
}));

/** Current standing; players without a row get ELO_START / 0 games / 0 wins / peak ELO_START. */
export function getRating(db: Db, playerId: string, mode: Mode): RatingRecord {
  const row = statements(db).get.get(playerId, mode);
  if (row) return { playerId, mode, ...row };
  return { playerId, mode, rating: CONFIG.ELO_START, games: 0, wins: 0, peak: CONFIG.ELO_START };
}

/** Both modes as the RatingInfo DTOs used by profiles. */
export function getRatingInfos(db: Db, playerId: string): Record<Mode, RatingInfo> {
  const info = (mode: Mode): RatingInfo => {
    const { rating, games, wins, peak } = getRating(db, playerId, mode);
    return { mode, rating, games, wins, peak, tier: tierFor(rating) };
  };
  return { duel: info('duel'), ffa: info('ffa') };
}

/** Inserts or replaces a standing. `peak` never decreases: the stored value is max(old peak, new peak). */
export function upsertRating(db: Db, record: RatingRecord): void {
  statements(db).upsert.run(record);
}

/**
 * Top `limit` players of a mode with at least one ranked game, by rating desc. Equal ratings
 * share a rank (competition ranking: 1, 2, 2, 4).
 */
export function getLeaderboard(db: Db, mode: Mode, limit: number): LeaderboardEntry[] {
  const rows = statements(db).leaderboard.all(mode, toSqlLimit(limit));
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || row.rating !== rows[i - 1].rating) rank = i + 1;
    return {
      rank,
      playerId: row.player_id,
      nickname: row.nickname,
      tag: row.tag,
      rating: row.rating,
      tier: tierFor(row.rating),
      games: row.games,
      wins: row.wins,
      winrate: row.games > 0 ? row.wins / row.games : 0,
      animal: storedAnimal(row.selected_animal),
    };
  });
}
