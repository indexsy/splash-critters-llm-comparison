export const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    selected_animal TEXT NOT NULL DEFAULT 'frog',
    selected_hat TEXT NOT NULL DEFAULT 'none',
    custom_nickname INTEGER NOT NULL DEFAULT 0,
    tutorial_done INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_players_token ON players(token_hash);

  CREATE TABLE ratings (
    player_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT 1000,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    peak REAL NOT NULL DEFAULT 1000,
    PRIMARY KEY (player_id, mode)
  );

  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    ranked INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE match_players (
    match_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    placement INTEGER NOT NULL,
    soaks INTEGER NOT NULL DEFAULT 0,
    rounds_won INTEGER NOT NULL DEFAULT 0,
    rating_before REAL,
    rating_after REAL,
    xp_earned INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, player_id)
  );

  CREATE TABLE unlocks (
    player_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, item_id)
  );
  `,
];
