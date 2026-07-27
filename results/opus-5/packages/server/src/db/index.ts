/**
 * SQLite handle for the whole server. One file, opened once at boot.
 *
 * The database lives inside the data directory rather than next to the code so
 * a container can mount a volume over it and keep accounts across deploys.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export type DB = BetterSqlite3.Database;

/** Opens DATA_DIR/splash.db, enables WAL, runs migrations. Creates dirs as needed. */
export function openDatabase(dataDir: string): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new BetterSqlite3(join(dataDir, 'splash.db'));
  // WAL keeps readers off the writer's back; the game writes in short bursts
  // between matches, so durability is fine at NORMAL.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  // Must be set outside a transaction, so it happens before migrations run.
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * Applies every migration the file has not seen yet, in version order, each one
 * atomic with the row that records it. Re-running on an up-to-date file is a
 * no-op, which is what makes boot idempotent.
 */
function migrate(db: DB): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );

  const appliedRows = db.prepare<[], { version: number }>('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map((row) => row.version));
  const record = db.prepare<[number, number]>(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, Date.now());
    });
    apply();
  }
}
