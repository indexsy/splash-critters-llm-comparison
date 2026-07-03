// db/index.ts — SQLite via better-sqlite3, WAL mode, numbered migrations at boot.
// Stored at DATA_DIR/splash.db so it persists on a mounted volume (spec §1).
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as DB } from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: DB;

export function openDb(dataDir: string): DB {
  const path = join(dataDir, "splash.db");
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // migrations meta-table
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     );`,
  );

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r: any) => r.version as number),
  );

  // migrations live next to this compiled file (copied via tsc as assets? no —
  // we read from src sibling). We resolve the migrations folder relative to src.
  const migrationsDir = resolveMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const f of files) {
    const version = parseInt(f.slice(0, 4), 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    });
    tx();
    console.log(`[db] migration ${version} applied (${f})`);
  }
  return db;
}

function resolveMigrationsDir(): string {
  // When run from dist (compiled), migrations are copied alongside. When run via
  // tsx (src), they live in src/db/migrations. Prefer dist, fall back to src.
  const candidates = [
    join(__dirname, "migrations"),
    join(__dirname, "..", "..", "src", "db", "migrations"),
    join(process.cwd(), "packages", "server", "src", "db", "migrations"),
  ];
  for (const c of candidates) {
    try {
      if (readdirSync(c).length > 0) return c;
    } catch {
      /* try next */
    }
  }
  throw new Error("migrations directory not found");
}

export function getDb(): DB {
  if (!db) throw new Error("db not opened");
  return db;
}
