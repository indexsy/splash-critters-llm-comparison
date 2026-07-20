/**
 * SQLite handle. Opens (or creates) the DB in WAL mode under DATA_DIR and runs
 * numbered migrations at boot. Persists across restarts on a mounted volume.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIGRATIONS } from './migrations';

export type DB = Database.Database;

let db: DB | null = null;

export function getDataDir(): string {
  return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
}

export function openDb(): DB {
  if (db) return db;
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'splash.db');
  const handle = new Database(file);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('synchronous = NORMAL');
  runMigrations(handle);
  db = handle;
  return db;
}

function runMigrations(handle: DB): void {
  handle.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);`,
  );
  const applied = new Set<number>(
    handle
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const tx = handle.transaction(() => {
      handle.exec(m.sql);
      handle
        .prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, Date.now());
    });
    tx();
    // eslint-disable-next-line no-console
    console.log(`[db] applied migration ${m.version} (${m.name})`);
  }
}

/** For tests / soak: open an isolated in-memory DB with migrations applied. */
export function openMemoryDb(): DB {
  const handle = new Database(':memory:');
  handle.pragma('foreign_keys = ON');
  runMigrations(handle);
  return handle;
}
