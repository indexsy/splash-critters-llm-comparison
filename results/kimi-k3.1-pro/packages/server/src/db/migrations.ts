import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

export function runMigrations(database: Database.Database): void {
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const directory = fileURLToPath(new URL("./migrations", import.meta.url));
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version));
  const files = readdirSync(directory).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (applied.has(version)) continue;
    const sql = readFileSync(`${directory}/${file}`, "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(version, file, Date.now());
    })();
  }
}
