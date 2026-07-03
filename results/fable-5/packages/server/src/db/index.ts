import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations.js";

// Single-file SQLite at DATA_DIR/splash.db (WAL) so it persists on a mounted
// volume in production. Tests/soak can use SPLASH_DB=:memory:.

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

function openDb(): Database.Database {
  const target = process.env.SPLASH_DB;
  if (target === ":memory:") return new Database(":memory:");
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(target || path.join(DATA_DIR, "splash.db"));
  db.pragma("journal_mode = WAL");
  return db;
}

export type DB = Database.Database;
export const db: DB = openDb();

export function migrate(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER)`);
  const appliedIds = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map((r) => r.id)
  );
  for (const m of MIGRATIONS) {
    if (appliedIds.has(m.id)) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare(`INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)`).run(
        m.id,
        m.name,
        Date.now()
      );
    });
    run();
    console.log(`[db] applied migration ${m.id} (${m.name})`);
  }
}
