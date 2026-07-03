-- 0001_init.sql — core schema (spec §2).
-- Lightweight accounts: device-token based, no passwords.

CREATE TABLE players (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT UNIQUE NOT NULL,
  nickname      TEXT,
  tag           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  xp            INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  selected_animal TEXT NOT NULL DEFAULT 'frog',
  selected_hat  TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE ratings (
  player_id  TEXT NOT NULL,
  mode       TEXT NOT NULL,
  rating     INTEGER NOT NULL DEFAULT 1000,
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  peak       INTEGER NOT NULL DEFAULT 1000,
  PRIMARY KEY (player_id, mode),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE matches (
  id         TEXT PRIMARY KEY,
  mode       TEXT NOT NULL,
  ranked     INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT
);

CREATE TABLE match_players (
  match_id     TEXT NOT NULL,
  player_id    TEXT NOT NULL,
  placement    INTEGER NOT NULL,
  soaks        INTEGER NOT NULL DEFAULT 0,
  rounds_won   INTEGER NOT NULL DEFAULT 0,
  rating_before INTEGER,
  rating_after  INTEGER,
  xp_earned    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE unlocks (
  player_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, item_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX idx_ratings_mode ON ratings(mode, rating DESC);
CREATE INDEX idx_match_players_player ON match_players(player_id);
