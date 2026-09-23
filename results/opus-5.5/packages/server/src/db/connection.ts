// Opens the SQLite database (DATA_DIR/splash.db, or an in-memory db for tests), applies the
// connection pragmas and runs pending migrations.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate';

export type Db = Database.Database;

export const DB_FILE_NAME = 'splash.db';
const BUSY_TIMEOUT_MS = 5000;

function applyPragmas(db: Db, inMemory: boolean): void {
  if (!inMemory) {
    db.pragma('journal_mode = WAL');
    // WAL + NORMAL is durable across application crashes and much faster than FULL.
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
}

const UNWRITABLE_CODES = new Set(['SQLITE_READONLY', 'SQLITE_CANTOPEN', 'SQLITE_PERM', 'SQLITE_READONLY_DIRECTORY']);

function unwritableError(dataDir: string, cause: unknown): Error {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
  return new Error(`DATA_DIR ${dataDir} is not writable by uid ${uid}; mount a writable volume there`, { cause });
}

function isUnwritable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && UNWRITABLE_CODES.has(code);
}

/**
 * SQLite silently opens an unwritable file read-only (db.readonly stays false and BEGIN
 * IMMEDIATE still succeeds), after which the server would look healthy while every write failed.
 * Only a real write attempt tells, so make one and roll it back.
 */
function assertWritable(db: Db): void {
  db.exec('SAVEPOINT write_probe; CREATE TABLE __write_probe(x); ROLLBACK TO write_probe; RELEASE write_probe');
}

/**
 * Opens (creating if needed) `dataDir/splash.db`, or a private in-memory database when
 * `dataDir === ':memory:'`. Enables WAL, foreign keys and a busy timeout, migrates, and fails
 * fast with a clear message when the data directory or database is not writable.
 */
export function openDb(dataDir: string): Db {
  const inMemory = dataDir === ':memory:';
  let db: Db;
  try {
    if (!inMemory) mkdirSync(dataDir, { recursive: true });
    db = new Database(inMemory ? ':memory:' : join(dataDir, DB_FILE_NAME));
  } catch (err) {
    throw isUnwritable(err) || (err as { code?: string }).code === 'EACCES' ? unwritableError(dataDir, err) : err;
  }
  try {
    applyPragmas(db, inMemory);
    runMigrations(db);
    if (!inMemory) assertWritable(db);
  } catch (err) {
    db.close();
    throw isUnwritable(err) ? unwritableError(dataDir, err) : err;
  }
  return db;
}
