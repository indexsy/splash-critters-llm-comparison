// Per-connection prepared-statement cache: each query module declares its statements once and
// gets them compiled lazily for whichever Db it is called with.
import type { Db } from './connection';

/** Wraps a statement factory so it runs once per Db connection and is reused afterwards. */
export function preparedStatements<T>(build: (db: Db) => T): (db: Db) => T {
  const cache = new WeakMap<Db, T>();
  return (db: Db) => {
    let statements = cache.get(db);
    if (!statements) {
      statements = build(db);
      cache.set(db, statements);
    }
    return statements;
  };
}

/**
 * A caller-supplied row limit made safe for SQL LIMIT: floored and clamped to 0..MAX_SAFE_INTEGER.
 * NaN (e.g. parseInt of a missing query param) becomes 0 instead of a SQLite datatype mismatch.
 */
export function toSqlLimit(limit: number): number {
  if (Number.isNaN(limit)) return 0;
  return Math.min(Math.max(0, Math.floor(limit)), Number.MAX_SAFE_INTEGER);
}

/** SQLite stores booleans as 0/1 integers. */
export function toSqlBool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}
