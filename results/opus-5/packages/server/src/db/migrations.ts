/**
 * Forward-only schema history.
 *
 * Migrations are applied in ascending version order, each in its own
 * transaction, and recorded in `schema_migrations`. Never edit a version that
 * has already shipped - add a new one, because live volumes only ever move
 * forward.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * The whole game in five tables. `players` is the account, `ratings` is one row
 * per (player, mode), and matches are split into a header plus one row per
 * participant so history reads are a single indexed join.
 */
const INITIAL_SCHEMA = `
CREATE TABLE players (
  id              TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL UNIQUE,
  nickname        TEXT NOT NULL,
  tag             TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  xp              INTEGER NOT NULL DEFAULT 0,
  level           INTEGER NOT NULL DEFAULT 1,
  selected_animal TEXT NOT NULL DEFAULT 'frog',
  selected_hat    TEXT NOT NULL DEFAULT 'none',
  tutorial_done   INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX players_nickname_tag_idx ON players (nickname, tag);

CREATE TABLE ratings (
  player_id TEXT NOT NULL,
  mode      TEXT NOT NULL,
  rating    INTEGER NOT NULL,
  games     INTEGER NOT NULL DEFAULT 0,
  wins      INTEGER NOT NULL DEFAULT 0,
  peak      INTEGER NOT NULL,
  PRIMARY KEY (player_id, mode),
  FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
);

-- Leaderboard reads the top of this index directly, no sort needed.
CREATE INDEX ratings_mode_rating_idx ON ratings (mode, rating DESC);

CREATE TABLE matches (
  id         TEXT PRIMARY KEY,
  mode       TEXT NOT NULL,
  ranked     INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL
);

CREATE TABLE match_players (
  match_id      TEXT NOT NULL,
  player_id     TEXT NOT NULL,
  placement     INTEGER NOT NULL,
  soaks         INTEGER NOT NULL,
  rounds_won    INTEGER NOT NULL,
  rating_before INTEGER,
  rating_after  INTEGER,
  xp_earned     INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
);

CREATE INDEX match_players_player_idx ON match_players (player_id);

CREATE TABLE unlocks (
  player_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id),
  FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial_schema', sql: INITIAL_SCHEMA },
];
