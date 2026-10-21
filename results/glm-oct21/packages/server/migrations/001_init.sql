CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  selected_animal TEXT NOT NULL DEFAULT 'frog',
  selected_hat TEXT NOT NULL DEFAULT 'none',
  settings TEXT NOT NULL DEFAULT '{}',
  tutorial_done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ratings (
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  peak INTEGER NOT NULL DEFAULT 1000,
  PRIMARY KEY (player_id, mode)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  ranked INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  placement INTEGER NOT NULL,
  soaks INTEGER NOT NULL DEFAULT 0,
  rounds_won INTEGER NOT NULL DEFAULT 0,
  rating_before INTEGER,
  rating_after INTEGER,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS unlocks (
  player_id TEXT NOT NULL REFERENCES players(id),
  item_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players(nickname, tag);
CREATE INDEX IF NOT EXISTS idx_ratings_mode ON ratings(mode, rating DESC);
