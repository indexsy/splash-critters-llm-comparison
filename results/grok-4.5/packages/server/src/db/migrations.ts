export const MIGRATIONS: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        selected_animal TEXT NOT NULL DEFAULT 'frog',
        selected_hat TEXT NOT NULL DEFAULT 'none',
        UNIQUE(nickname, tag)
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
        ranked INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        placement INTEGER,
        soaks INTEGER NOT NULL DEFAULT 0,
        rounds_won INTEGER NOT NULL DEFAULT 0,
        rating_before INTEGER,
        rating_after INTEGER,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, player_id),
        FOREIGN KEY (match_id) REFERENCES matches(id),
        FOREIGN KEY (player_id) REFERENCES players(id)
      );

      CREATE TABLE IF NOT EXISTS unlocks (
        player_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (player_id, item_id),
        FOREIGN KEY (player_id) REFERENCES players(id)
      );
    `,
  },
];
