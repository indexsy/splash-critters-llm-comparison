import type { Database } from 'better-sqlite3';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Numbered migrations. They are applied in order exactly once. */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        tag TEXT NOT NULL,
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
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        ranked INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        placement INTEGER NOT NULL,
        soaks INTEGER NOT NULL DEFAULT 0,
        rounds_won INTEGER NOT NULL DEFAULT 0,
        rating_before INTEGER,
        rating_after INTEGER,
        xp_earned INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, player_id),
        FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS unlocks (
        player_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ratings_mode ON ratings(mode, rating DESC);
      CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);
    `,
  },
];

export function runMigrations(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );
  const rows = db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[];
  const applied = new Set(rows.map((r) => r.id));
  const insert = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      insert.run(migration.id, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
