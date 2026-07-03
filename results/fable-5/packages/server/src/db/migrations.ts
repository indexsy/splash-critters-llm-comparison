// Numbered SQL migrations, applied in order at boot. NEVER edit an existing
// migration after it has shipped — append a new one.

export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init",
    sql: `
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
        has_custom_nickname INTEGER NOT NULL DEFAULT 0,
        tutorial_done INTEGER NOT NULL DEFAULT 0,
        UNIQUE(nickname, tag)
      );

      CREATE TABLE ratings (
        player_id TEXT NOT NULL REFERENCES players(id),
        mode TEXT NOT NULL CHECK (mode IN ('duel','ffa')),
        rating INTEGER NOT NULL,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        peak INTEGER NOT NULL,
        PRIMARY KEY (player_id, mode)
      );
      CREATE INDEX idx_ratings_mode_rating ON ratings(mode, rating DESC);

      CREATE TABLE matches (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        ranked INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE match_players (
        match_id TEXT NOT NULL REFERENCES matches(id),
        player_id TEXT NOT NULL,
        placement INTEGER NOT NULL,
        soaks INTEGER NOT NULL DEFAULT 0,
        rounds_won INTEGER NOT NULL DEFAULT 0,
        rating_before INTEGER,
        rating_after INTEGER,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, player_id)
      );
      CREATE INDEX idx_match_players_player ON match_players(player_id);

      CREATE TABLE unlocks (
        player_id TEXT NOT NULL REFERENCES players(id),
        item_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item_id)
      );
    `,
  },
];
