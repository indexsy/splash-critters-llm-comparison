import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  ANIMALS,
  CONFIG,
  HATS,
  levelFromXp,
  type AnimalId,
  type HatId,
  type Mode,
  type Profile,
} from "@splash/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "splash.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const dir = join(__dirname, "migrations");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    applyInlineMigration(db);
    return;
  }
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: string }).id),
  );
  for (const f of files) {
    if (applied.has(f)) continue;
    db.exec(readFileSync(join(dir, f), "utf8"));
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(f, Date.now());
  }
}

function applyInlineMigration(db: Database.Database): void {
  const id = "001_init.sql";
  const exists = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(id);
  if (exists) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      tag INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      selected_animal TEXT NOT NULL DEFAULT 'frog',
      selected_hat TEXT NOT NULL DEFAULT 'none'
    );
    CREATE TABLE IF NOT EXISTS ratings (
      player_id TEXT NOT NULL,
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
      match_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      placement INTEGER NOT NULL,
      soaks INTEGER NOT NULL,
      rounds_won INTEGER NOT NULL,
      rating_before INTEGER,
      rating_after INTEGER,
      xp_earned INTEGER NOT NULL,
      PRIMARY KEY (match_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS unlocks (
      player_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, item_id)
    );
  `);
  db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
}

const GUEST_ADJ = ["Soggy", "Drippy", "Damp", "Splashy", "Bubbly", "Misty", "Puddle", "Wavy", "Foamy", "Dewy"];
const GUEST_NOUN = ["Otter", "Frog", "Duck", "Newt", "Crab", "Seal", "Toad", "Guppy", "Clam", "Finch"];

export function createGuest(db: Database.Database, token?: string): { token: string; profile: Profile } {
  const t = token ?? randomUUID();
  const hash = hashToken(t);
  const existing = db.prepare("SELECT id FROM players WHERE token_hash = ?").get(hash) as { id: string } | undefined;
  if (existing) return { token: t, profile: loadProfile(db, existing.id)! };

  const id = randomUUID();
  const nickname = `${GUEST_ADJ[Math.floor(Math.random() * GUEST_ADJ.length)]}${GUEST_NOUN[Math.floor(Math.random() * GUEST_NOUN.length)]}`;
  let tag = 1000 + Math.floor(Math.random() * 9000);
  while (db.prepare("SELECT 1 FROM players WHERE nickname = ? AND tag = ?").get(nickname, tag)) {
    tag = 1000 + Math.floor(Math.random() * 9000);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO players (id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat)
     VALUES (?, ?, ?, ?, ?, 0, 1, 'frog', 'none')`,
  ).run(id, hash, nickname, tag, now);
  for (const mode of ["duel", "ffa"] as const) {
    db.prepare(
      `INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 0, 0, ?)`,
    ).run(id, mode, CONFIG.ELO_START, CONFIG.ELO_START);
  }
  grantUnlock(db, id, "frog");
  grantUnlock(db, id, "duck");
  grantUnlock(db, id, "none");
  return { token: t, profile: loadProfile(db, id)! };
}

export function loadProfile(db: Database.Database, id: string): Profile | null {
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(id) as
    | {
        id: string;
        nickname: string;
        tag: number;
        xp: number;
        level: number;
        selected_animal: AnimalId;
        selected_hat: HatId;
      }
    | undefined;
  if (!row) return null;
  const ratings = db.prepare("SELECT mode, rating, games, wins, peak FROM ratings WHERE player_id = ?").all(id) as {
    mode: Mode;
    rating: number;
    games: number;
    wins: number;
    peak: number;
  }[];
  const unlocks = (
    db.prepare("SELECT item_id FROM unlocks WHERE player_id = ?").all(id) as { item_id: string }[]
  ).map((r) => r.item_id);
  const ratingMap = {
    duel: ratings.find((r) => r.mode === "duel") ?? {
      mode: "duel" as const,
      rating: CONFIG.ELO_START,
      games: 0,
      wins: 0,
      peak: CONFIG.ELO_START,
    },
    ffa: ratings.find((r) => r.mode === "ffa") ?? {
      mode: "ffa" as const,
      rating: CONFIG.ELO_START,
      games: 0,
      wins: 0,
      peak: CONFIG.ELO_START,
    },
  };
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    xp: row.xp,
    level: row.level,
    selectedAnimal: row.selected_animal,
    selectedHat: row.selected_hat,
    ratings: ratingMap,
    unlocks,
  };
}

export function findByToken(db: Database.Database, token: string): Profile | null {
  const row = db.prepare("SELECT id FROM players WHERE token_hash = ?").get(hashToken(token)) as
    | { id: string }
    | undefined;
  return row ? loadProfile(db, row.id) : null;
}

const PROFANITY = ["fuck", "shit", "ass", "bitch", "cunt", "nigger", "faggot", "rape"];

export function setNickname(db: Database.Database, id: string, raw: string): { ok: true } | { ok: false; msg: string } {
  const nickname = raw.trim();
  if (nickname.length < CONFIG.NICKNAME_MIN || nickname.length > CONFIG.NICKNAME_MAX) {
    return { ok: false, msg: `Nickname must be ${CONFIG.NICKNAME_MIN}–${CONFIG.NICKNAME_MAX} characters` };
  }
  if (!/^[A-Za-z0-9_]+$/.test(nickname)) {
    return { ok: false, msg: "Letters, numbers, and underscore only" };
  }
  if (PROFANITY.some((w) => nickname.toLowerCase().includes(w))) {
    return { ok: false, msg: "Nickname not allowed" };
  }
  const player = db.prepare("SELECT tag FROM players WHERE id = ?").get(id) as { tag: number } | undefined;
  if (!player) return { ok: false, msg: "Unknown player" };
  db.prepare("UPDATE players SET nickname = ? WHERE id = ?").run(nickname, id);
  return { ok: true };
}

export function setCosmetic(db: Database.Database, id: string, animal: AnimalId, hat: HatId): boolean {
  const unlocks = new Set(
    (db.prepare("SELECT item_id FROM unlocks WHERE player_id = ?").all(id) as { item_id: string }[]).map((r) => r.item_id),
  );
  if (!unlocks.has(animal) || !unlocks.has(hat)) return false;
  db.prepare("UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?").run(animal, hat, id);
  return true;
}

export function grantUnlock(db: Database.Database, playerId: string, itemId: string): void {
  db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)").run(
    playerId,
    itemId,
    Date.now(),
  );
}

export function addXp(db: Database.Database, playerId: string, amount: number): { xp: number; level: number; newUnlocks: string[] } {
  const row = db.prepare("SELECT xp, level FROM players WHERE id = ?").get(playerId) as
    | { xp: number; level: number }
    | undefined;
  if (!row) return { xp: 0, level: 1, newUnlocks: [] };
  const xp = row.xp + amount;
  const level = levelFromXp(xp);
  db.prepare("UPDATE players SET xp = ?, level = ? WHERE id = ?").run(xp, level, playerId);
  const newUnlocks: string[] = [];
  for (const a of ANIMALS) {
    if (level >= a.unlockLevel) {
      const before = db.prepare("SELECT 1 FROM unlocks WHERE player_id = ? AND item_id = ?").get(playerId, a.id);
      grantUnlock(db, playerId, a.id);
      if (!before) newUnlocks.push(a.id);
    }
  }
  for (const h of HATS) {
    if (level >= h.unlockLevel) {
      const before = db.prepare("SELECT 1 FROM unlocks WHERE player_id = ? AND item_id = ?").get(playerId, h.id);
      grantUnlock(db, playerId, h.id);
      if (!before) newUnlocks.push(h.id);
    }
  }
  return { xp, level, newUnlocks };
}

export function updateRating(
  db: Database.Database,
  playerId: string,
  mode: Mode,
  after: number,
  won: boolean,
): void {
  const row = db.prepare("SELECT games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?").get(
    playerId,
    mode,
  ) as { games: number; wins: number; peak: number } | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(playerId, mode, after, won ? 1 : 0, after);
    return;
  }
  db.prepare(
    `UPDATE ratings SET rating = ?, games = ?, wins = ?, peak = ? WHERE player_id = ? AND mode = ?`,
  ).run(after, row.games + 1, row.wins + (won ? 1 : 0), Math.max(row.peak, after), playerId, mode);
}

export function recordMatch(
  db: Database.Database,
  match: {
    id: string;
    mode: Mode;
    ranked: boolean;
    startedAt: number;
    endedAt: number;
    players: {
      playerId: string;
      placement: number;
      soaks: number;
      roundsWon: number;
      ratingBefore?: number;
      ratingAfter?: number;
      xpEarned: number;
    }[];
  },
): void {
  db.prepare(`INSERT INTO matches (id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, ?)`).run(
    match.id,
    match.mode,
    match.ranked ? 1 : 0,
    match.startedAt,
    match.endedAt,
  );
  const ins = db.prepare(
    `INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of match.players) {
    ins.run(
      match.id,
      p.playerId,
      p.placement,
      p.soaks,
      p.roundsWon,
      p.ratingBefore ?? null,
      p.ratingAfter ?? null,
      p.xpEarned,
    );
  }
}

export function leaderboard(db: Database.Database, mode: Mode, limit = 100) {
  return db
    .prepare(
      `SELECT p.nickname, p.tag, r.rating, r.games, r.wins
       FROM ratings r JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC, r.wins DESC
       LIMIT ?`,
    )
    .all(mode, limit) as { nickname: string; tag: number; rating: number; games: number; wins: number }[];
}

export function recentMatches(db: Database.Database, playerId: string, limit = 10) {
  return db
    .prepare(
      `SELECT m.id, m.mode, m.ranked, m.started_at, m.ended_at, mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after, mp.xp_earned
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ?
       ORDER BY m.ended_at DESC LIMIT ?`,
    )
    .all(playerId, limit);
}
