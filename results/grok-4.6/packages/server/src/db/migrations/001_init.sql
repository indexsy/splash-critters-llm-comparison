CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  tag INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  selected_animal TEXT NOT NULL DEFAULT 'frog',
  selected_hat TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE IF NOT EXISTS ratings (
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  peak INTEGER NOT NULL DEFAULT 1000,
  PRIMARY KEY (player_id, mode),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  ranked INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  placement INTEGER NOT NULL,
  soaks INTEGER NOT NULL,
  rounds_won INTEGER NOT NULL,
  rating_before INTEGER,
  rating_after INTEGER,
  xp_earned INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS unlocks (
  player_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_mode_rating ON ratings(mode, rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_nick_tag ON players(nickname, tag);
