// Applies pending numbered migrations, each inside its own transaction, and records them in
// schema_migrations. Safe to run on every boot: already-applied versions are skipped.
import type { Db } from './connection';
import { MIGRATIONS, type Migration } from './migrations';

/** Throws if the embedded migration list is not strictly increasing from version 1. */
function assertOrdered(migrations: Migration[]): void {
  migrations.forEach((migration, i) => {
    if (migration.version !== i + 1) {
      throw new Error(`Migration list out of order: expected version ${i + 1}, found ${migration.version}`);
    }
  });
}

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

function appliedVersions(db: Db): Set<number> {
  const rows = db.prepare<[], { version: number }>('SELECT version FROM schema_migrations').all();
  return new Set(rows.map((row) => row.version));
}

function applyMigration(db: Db, migration: Migration): void {
  const record = db.prepare<[number, number]>('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  db.transaction(() => {
    db.exec(migration.sql);
    record.run(migration.version, Date.now());
  })();
}

/** Runs every pending migration in order. Returns the versions applied by this call. */
export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): number[] {
  assertOrdered(migrations);
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  for (const migration of pending) applyMigration(db, migration);
  return pending.map((migration) => migration.version);
}
