import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "./migrations.js";
import { SplashQueries } from "./queries.js";

export class SplashDatabase extends SplashQueries {
  constructor(dataDir: string) {
    const directory = resolve(dataDir);
    mkdirSync(directory, { recursive: true });
    const database = new Database(resolve(directory, "splash.db"));
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    runMigrations(database);
    super(database);
  }
}

export type { MatchRecord, MatchPlayerRecord, ProfileRecord } from "./queries.js";
