/**
 * Numbered SQL migrations, applied in order at boot.
 * Embedded as strings (not .sql files) so the esbuild single-file bundle
 * carries them without extra asset handling.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
    CREATE TABLE IF NOT EXISTS players (
      id            TEXT PRIMARY KEY,
      token_hash    TEXT NOT NULL UNIQUE,
      nickname      TEXT,
      tag           TEXT,
      created_at    INTEGER NOT NULL,
      xp            INTEGER NOT NULL DEFAULT 0,
      level         INTEGER NOT NULL DEFAULT 1,
      selected_animal TEXT NOT NULL DEFAULT 'frog',
      selected_hat  TEXT NOT NULL DEFAULT 'none'
    );
    CREATE INDEX IF NOT EXISTS idx_players_nick ON players(nickname, tag);

    CREATE TABLE IF NOT EXISTS ratings (
      player_id  TEXT NOT NULL,
      mode       TEXT NOT NULL,
      rating     INTEGER NOT NULL DEFAULT 1000,
      games      INTEGER NOT NULL DEFAULT 0,
      wins       INTEGER NOT NULL DEFAULT 0,
      peak       INTEGER NOT NULL DEFAULT 1000,
      PRIMARY KEY (player_id, mode),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ratings_mode ON ratings(mode, rating DESC);

    CREATE TABLE IF NOT EXISTS matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      mode       TEXT NOT NULL,
      ranked     INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER
    );

    CREATE TABLE IF NOT EXISTS match_players (
      match_id      INTEGER NOT NULL,
      player_id     TEXT NOT NULL,
      placement     INTEGER NOT NULL,
      soaks         INTEGER NOT NULL DEFAULT 0,
      rounds_won    INTEGER NOT NULL DEFAULT 0,
      rating_before INTEGER,
      rating_after  INTEGER,
      xp_earned     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (match_id, player_id),
      FOREIGN KEY (match_id) REFERENCES matches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mp_player ON match_players(player_id);

    CREATE TABLE IF NOT EXISTS unlocks (
      player_id   TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, item_id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
    `,
  },
];
