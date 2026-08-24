import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS: string[] = [
  // 001 initial schema
  `
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    selected_animal TEXT NOT NULL DEFAULT 'frog',
    selected_hat TEXT,
    nickname_custom INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nick ON players(nickname, tag);
  CREATE TABLE IF NOT EXISTS ratings (
    player_id TEXT NOT NULL REFERENCES players(id),
    mode TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1000,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    peak INTEGER NOT NULL DEFAULT 1000,
    PRIMARY KEY (player_id, mode)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    ranked INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES matches(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    placement INTEGER NOT NULL,
    soaks INTEGER NOT NULL DEFAULT 0,
    rounds_won INTEGER NOT NULL DEFAULT 0,
    rating_before INTEGER,
    rating_after INTEGER,
    xp_earned INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS unlocks (
    player_id TEXT NOT NULL REFERENCES players(id),
    item_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, item_id)
  );
  `,
];

export function openDb(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "splash.db"));
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (num INTEGER PRIMARY KEY, applied_at INTEGER)");
  const applied = new Set(
    (db.prepare("SELECT num FROM _migrations").all() as Array<{ num: number }>).map((r) => r.num),
  );
  MIGRATIONS.forEach((sql, i) => {
    const num = i + 1;
    if (applied.has(num)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (num, applied_at) VALUES (?, ?)").run(num, Date.now());
    })();
  });
  return db;
}
