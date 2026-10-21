export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
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
        name_set INTEGER NOT NULL DEFAULT 0,
        tutorial_done INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS ratings (
        player_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 1000,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        peak INTEGER NOT NULL DEFAULT 1000,
        PRIMARY KEY (player_id, mode),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        ranked INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        room_code TEXT
      );

      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        placement INTEGER NOT NULL,
        soaks INTEGER NOT NULL DEFAULT 0,
        rounds_won INTEGER NOT NULL DEFAULT 0,
        rating_before INTEGER,
        rating_after INTEGER,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        castles INTEGER NOT NULL DEFAULT 0,
        biggest_chain INTEGER NOT NULL DEFAULT 0,
        survived_ticks INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, player_id),
        FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS unlocks (
        player_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ratings_mode_rating
        ON ratings(mode, rating DESC);
      CREATE INDEX IF NOT EXISTS idx_match_players_player
        ON match_players(player_id, match_id DESC);
      CREATE INDEX IF NOT EXISTS idx_matches_ended
        ON matches(ended_at DESC);
    `,
  },
];
