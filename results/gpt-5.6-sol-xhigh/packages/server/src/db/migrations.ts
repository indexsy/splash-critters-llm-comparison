import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 1;

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        id TEXT NOT NULL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        tag TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        selected_animal TEXT NOT NULL DEFAULT 'frog',
        selected_hat TEXT NOT NULL DEFAULT 'none',
        has_custom_nickname INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_players_nickname ON players(nickname);
      CREATE INDEX IF NOT EXISTS idx_players_token ON players(token_hash);

      CREATE TABLE IF NOT EXISTS ratings (
        player_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        rating INTEGER NOT NULL,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        peak INTEGER NOT NULL DEFAULT 1000,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, mode)
      );

      CREATE INDEX IF NOT EXISTS idx_ratings_mode ON ratings(mode, rating DESC);

      CREATE TABLE IF NOT EXISTS pairwise_ratings (
        player_a TEXT NOT NULL,
        player_b TEXT NOT NULL,
        mode TEXT NOT NULL,
        games INTEGER NOT NULL DEFAULT 0,
        wins_a INTEGER NOT NULL DEFAULT 0,
        wins_b INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_a, player_b, mode)
      );

      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        ranked INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        room_code TEXT,
        rounds_to_win INTEGER,
        theme TEXT,
        duration_ticks INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at DESC);

      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        bot INTEGER NOT NULL DEFAULT 0,
        placement INTEGER NOT NULL,
        rounds_won INTEGER NOT NULL DEFAULT 0,
        soaks INTEGER NOT NULL DEFAULT 0,
        castles INTEGER NOT NULL DEFAULT 0,
        rating_before INTEGER NOT NULL DEFAULT 0,
        rating_after INTEGER NOT NULL DEFAULT 0,
        rating_delta INTEGER NOT NULL DEFAULT 0,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, player_id),
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );

      CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);

      CREATE TABLE IF NOT EXISTS unlocks (
        player_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item_id),
        FOREIGN KEY (player_id) REFERENCES players(id)
      );
    `
  }
];

export function runMigrations(db: Database.Database): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);");
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null } | undefined;
  const applied = row?.v ?? 0;
  const pending = MIGRATIONS.filter((m) => m.version > applied).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return applied;
  const tx = db.transaction((entries: Migration[]) => {
    for (const m of entries) {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(m.version);
    }
  });
  tx(pending);
  return CURRENT_SCHEMA_VERSION;
}
