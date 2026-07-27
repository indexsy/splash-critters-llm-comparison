/**
 * Every SQL statement the server runs, prepared once against an open database.
 *
 * Nothing above this file knows a column name: the service layer binds
 * positional parameters and maps the row shapes below into domain objects.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { DB } from './index.js';

type Stmt<Params extends unknown[], Row = unknown> = BetterSqlite3.Statement<Params, Row>;

// --------------------------------------------------------------------- rows

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string;
  tag: string;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
  tutorial_done: number;
}

export interface RatingRow {
  player_id: string;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface LeaderboardQueryRow {
  player_id: string;
  nickname: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
}

export interface MatchHistoryQueryRow {
  match_id: string;
  mode: string;
  ranked: number;
  ended_at: number;
  placement: number;
  soaks: number;
  rounds_won: number;
  rating_before: number | null;
  rating_after: number | null;
  xp_earned: number;
}

export interface TagRow {
  tag: string;
}

export interface ItemRow {
  item_id: string;
}

// ---------------------------------------------------------------- statements

export interface Queries {
  /** New account. xp, level, cosmetics and tutorial come from column defaults. */
  insertPlayer: Stmt<[string, string, string, string, number]>;
  playerByTokenHash: Stmt<[string], PlayerRow>;
  playerById: Stmt<[string], PlayerRow>;
  /** Tags already spoken for under a nickname, ignoring the caller's own row. */
  tagsForNickname: Stmt<[string, string], TagRow>;
  updateNameTag: Stmt<[string, string, string]>;
  updateCosmetics: Stmt<[string, string, string]>;
  updateXp: Stmt<[number, number, string]>;
  markTutorialDone: Stmt<[string]>;

  ratingFor: Stmt<[string, string], RatingRow>;
  /** player_id, mode, rating, wins increment, rating again for the peak test. */
  upsertRating: Stmt<[string, string, number, number, number]>;
  leaderboard: Stmt<[string, number], LeaderboardQueryRow>;

  insertMatch: Stmt<[string, string, number, number, number]>;
  insertMatchPlayer: Stmt<
    [string, string, number, number, number, number | null, number | null, number]
  >;
  recentMatches: Stmt<[string, number], MatchHistoryQueryRow>;

  insertUnlock: Stmt<[string, string, number]>;
  unlocksFor: Stmt<[string], ItemRow>;
}

export function createQueries(db: DB): Queries {
  return {
    insertPlayer: db.prepare<[string, string, string, string, number]>(
      `INSERT INTO players (id, token_hash, nickname, tag, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    playerByTokenHash: db.prepare<[string], PlayerRow>('SELECT * FROM players WHERE token_hash = ?'),
    playerById: db.prepare<[string], PlayerRow>('SELECT * FROM players WHERE id = ?'),
    tagsForNickname: db.prepare<[string, string], TagRow>(
      'SELECT tag FROM players WHERE nickname = ? AND id <> ?',
    ),
    updateNameTag: db.prepare<[string, string, string]>(
      'UPDATE players SET nickname = ?, tag = ? WHERE id = ?',
    ),
    updateCosmetics: db.prepare<[string, string, string]>(
      'UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?',
    ),
    updateXp: db.prepare<[number, number, string]>('UPDATE players SET xp = ?, level = ? WHERE id = ?'),
    markTutorialDone: db.prepare<[string]>('UPDATE players SET tutorial_done = 1 WHERE id = ?'),

    ratingFor: db.prepare<[string, string], RatingRow>(
      'SELECT * FROM ratings WHERE player_id = ? AND mode = ?',
    ),
    // First game inserts at games = 1; later games bump the counters in place
    // and let peak ratchet upward only.
    upsertRating: db.prepare<[string, string, number, number, number]>(
      `INSERT INTO ratings (player_id, mode, rating, games, wins, peak)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT (player_id, mode) DO UPDATE SET
         rating = excluded.rating,
         games  = games + 1,
         wins   = wins + excluded.wins,
         peak   = max(peak, excluded.rating)`,
    ),
    leaderboard: db.prepare<[string, number], LeaderboardQueryRow>(
      `SELECT r.player_id AS player_id, p.nickname AS nickname, p.tag AS tag,
              r.rating AS rating, r.games AS games, r.wins AS wins
       FROM ratings r
       JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC, r.wins DESC, p.nickname ASC, r.player_id ASC
       LIMIT ?`,
    ),

    insertMatch: db.prepare<[string, string, number, number, number]>(
      `INSERT INTO matches (id, mode, ranked, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    insertMatchPlayer: db.prepare<
      [string, string, number, number, number, number | null, number | null, number]
    >(
      `INSERT INTO match_players
         (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    recentMatches: db.prepare<[string, number], MatchHistoryQueryRow>(
      `SELECT m.id AS match_id, m.mode AS mode, m.ranked AS ranked, m.ended_at AS ended_at,
              mp.placement AS placement, mp.soaks AS soaks, mp.rounds_won AS rounds_won,
              mp.rating_before AS rating_before, mp.rating_after AS rating_after,
              mp.xp_earned AS xp_earned
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ?
       ORDER BY m.ended_at DESC, m.id DESC
       LIMIT ?`,
    ),

    // Ignoring a duplicate is how the service tells old unlocks from new ones:
    // only an insert that actually changed a row is newly earned.
    insertUnlock: db.prepare<[string, string, number]>(
      'INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)',
    ),
    unlocksFor: db.prepare<[string], ItemRow>(
      'SELECT item_id FROM unlocks WHERE player_id = ? ORDER BY unlocked_at ASC, item_id ASC',
    ),
  };
}
