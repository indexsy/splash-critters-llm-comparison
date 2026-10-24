CREATE TABLE players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  selected_animal TEXT NOT NULL DEFAULT 'frog',
  selected_hat TEXT NOT NULL DEFAULT 'none',
  nickname_set INTEGER NOT NULL DEFAULT 0,
  tutorial_completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(nickname, tag)
);

CREATE TABLE ratings (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  peak INTEGER NOT NULL DEFAULT 1000,
  PRIMARY KEY(player_id, mode)
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  ranked INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  placement INTEGER NOT NULL,
  soaks INTEGER NOT NULL,
  rounds_won INTEGER NOT NULL,
  rating_before INTEGER,
  rating_after INTEGER,
  xp_earned INTEGER NOT NULL,
  PRIMARY KEY(match_id, player_id)
);

CREATE TABLE unlocks (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY(player_id, item_id)
);

CREATE INDEX idx_ratings_leaderboard ON ratings(mode, rating DESC, games DESC);
CREATE INDEX idx_match_players_player ON match_players(player_id, match_id);
CREATE INDEX idx_matches_started ON matches(started_at DESC);
