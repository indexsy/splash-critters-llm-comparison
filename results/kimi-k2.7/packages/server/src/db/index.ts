import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { Animal, Hat, LeaderboardEntry, MatchResult, Mode, Profile } from "@splash/shared";
import { CONFIG, tierForRating, xpProgress } from "@splash/shared";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT,
  tag TEXT,
  created_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  selected_animal TEXT NOT NULL DEFAULT 'frog',
  selected_hat TEXT NOT NULL DEFAULT 'none'
);

CREATE INDEX IF NOT EXISTS idx_players_token ON players(token_hash);

CREATE TABLE IF NOT EXISTS ratings (
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  peak INTEGER NOT NULL DEFAULT 1000,
  PRIMARY KEY (player_id, mode),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  ranked INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  placement INTEGER,
  soaks INTEGER NOT NULL DEFAULT 0,
  rounds_won INTEGER NOT NULL DEFAULT 0,
  rating_before INTEGER,
  rating_after INTEGER,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS unlocks (
  player_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
`;

let db: DatabaseType;

export function initDb(dataDir = process.env.DATA_DIR || "./data") {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "splash.db");
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(MIGRATION_SQL);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateTag(): string {
  return String(Math.floor(1000 + Math.random() * 8999));
}

export function guestName(): string {
  const prefixes = ["Soggy", "Wet", "Splashy", "Drippy", "Foamy", "Puddle", "Damp", "Briny"];
  const critters = ["Otter", "Duck", "Frog", "Penguin", "Turtle", "Cat", "Raccoon", "Capybara"];
  return `${prefixes[Math.floor(Math.random() * prefixes.length)]}${critters[Math.floor(Math.random() * critters.length)]}`;
}

export function profanityOk(name: string): boolean {
  const banned = ["bad", "evil", "hate", "kill", "damn"];
  return !banned.some((w) => name.toLowerCase().includes(w));
}

export function findOrCreatePlayer(token?: string): { id: string; token: string; isNew: boolean } {
  if (token) {
    const hash = hashToken(token);
    const row = db.prepare("SELECT id FROM players WHERE token_hash = ?").get(hash) as { id: string } | undefined;
    if (row) return { id: row.id, token, isNew: false };
  }
  const newToken = randomUUID();
  const id = randomUUID();
  const now = Date.now();
  const name = guestName();
  const tag = generateTag();
  db.prepare(
    "INSERT INTO players (id, token_hash, nickname, tag, created_at, xp, selected_animal, selected_hat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, hashToken(newToken), name, tag, now, 0, "frog", "none");
  db.prepare("INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    "duel",
    CONFIG.ELO_START,
    0,
    0,
    CONFIG.ELO_START
  );
  db.prepare("INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    "ffa",
    CONFIG.ELO_START,
    0,
    0,
    CONFIG.ELO_START
  );
  // Default unlocks
  db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)").run(id, "animal:frog", now);
  db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at)").run(id, "animal:duck", now);
  db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at)").run(id, "hat:none", now);
  return { id, token: newToken, isNew: true };
}

export function getProfile(playerId: string): Profile | undefined {
  const p = db.prepare("SELECT * FROM players WHERE id = ?").get(playerId) as any;
  if (!p) return undefined;
  const ratings = db.prepare("SELECT mode, rating, games, wins, peak FROM ratings WHERE player_id = ?").all(playerId) as any[];
  const unlocks = (db.prepare("SELECT item_id FROM unlocks WHERE player_id = ?").all(playerId) as any[]).map((u) => u.item_id);
  const xp = p.xp ?? 0;
  return {
    id: p.id,
    nickname: p.nickname,
    tag: p.tag,
    xp,
    level: xpProgress(xp).level,
    selectedAnimal: p.selected_animal,
    selectedHat: p.selected_hat,
    ratings: ratings.map((r) => ({
      mode: r.mode as Mode,
      rating: r.rating,
      games: r.games,
      wins: r.wins,
      peak: r.peak,
    })),
    unlocks,
  };
}

export function setNickname(playerId: string, nickname: string): boolean {
  if (nickname.length < 3 || nickname.length > 16) return false;
  if (!profanityOk(nickname)) return false;
  const existing = db.prepare("SELECT id FROM players WHERE nickname = ? AND id != ?").get(nickname, playerId);
  if (existing) return false;
  db.prepare("UPDATE players SET nickname = ? WHERE id = ?").run(nickname, playerId);
  return true;
}

export function updateSelection(playerId: string, animal?: Animal, hat?: Hat) {
  if (animal) db.prepare("UPDATE players SET selected_animal = ? WHERE id = ?").run(animal, playerId);
  if (hat) db.prepare("UPDATE players SET selected_hat = ? WHERE id = ?").run(hat, playerId);
}

export function addXp(playerId: string, xp: number) {
  const prev = (db.prepare("SELECT xp FROM players WHERE id = ?").get(playerId) as any)?.xp ?? 0;
  db.prepare("UPDATE players SET xp = ? WHERE id = ?").run(prev + xp, playerId);
  // Unlock cosmetics based on new level
  const profile = getProfile(playerId)!;
  const now = Date.now();
  for (const [animal, level] of Object.entries(CONFIG.ANIMAL_UNLOCK_LEVEL)) {
    if (profile.level >= level) {
      db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)").run(
        playerId,
        `animal:${animal}`,
        now
      );
    }
  }
  for (const [hat, level] of Object.entries(CONFIG.HAT_UNLOCK_LEVEL)) {
    if (profile.level >= level) {
      db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)").run(
        playerId,
        `hat:${hat}`,
        now
      );
    }
  }
}

export function getRatings(playerIds: string[], mode: Mode): Record<string, { rating: number; games: number; wins: number }> {
  const result: Record<string, { rating: number; games: number; wins: number }> = {};
  for (const id of playerIds) {
      const row = db.prepare("SELECT rating, games, wins FROM ratings WHERE player_id = ? AND mode = ?").get(id, mode) as any;
      result[id] = row ? { rating: row.rating, games: row.games, wins: row.wins } : { rating: CONFIG.ELO_START, games: 0, wins: 0 };
  }
  return result;
}

export function applyRatingChanges(mode: Mode, deltas: Record<string, number>, winners: string[]) {
  for (const [id, delta] of Object.entries(deltas)) {
    const row = db.prepare("SELECT rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?").get(id, mode) as any;
    if (!row) continue;
    const newRating = Math.max(0, row.rating + delta);
    const newGames = row.games + 1;
    const newWins = row.wins + (winners.includes(id) ? 1 : 0);
    const newPeak = Math.max(row.peak, newRating);
    db.prepare("UPDATE ratings SET rating = ?, games = ?, wins = ?, peak = ? WHERE player_id = ? AND mode = ?").run(
      newRating,
      newGames,
      newWins,
      newPeak,
      id,
      mode
    );
  }
}

export function recordMatch(result: MatchResult) {
  const now = Date.now();
  db.prepare("INSERT INTO matches (id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, ?)").run(
    result.matchId,
    result.mode,
    result.ranked ? 1 : 0,
    now,
    now
  );
  for (const pl of result.placements) {
    const s = result.stats[pl.playerId] ?? { soaks: 0, castles: 0, roundsWon: 0 };
    db.prepare(
      "INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, xp_earned) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(result.matchId, pl.playerId, pl.placement, s.soaks, s.roundsWon, result.xp[pl.playerId] ?? 0);
  }
}

export function getLeaderboard(mode: Mode, limit = 100): LeaderboardEntry[] {
  const rows = db
    .prepare(
      "SELECT p.nickname, p.tag, r.rating, r.games, r.wins FROM ratings r JOIN players p ON p.id = r.player_id WHERE r.mode = ? ORDER BY r.rating DESC LIMIT ?"
    )
    .all(mode, limit) as any[];
  return rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    tag: r.tag,
    rating: r.rating,
    tier: tierForRating(r.rating),
    games: r.games,
    winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
  }));
}

export function recentMatches(playerId: string, limit = 10): any[] {
  return db
    .prepare(
      "SELECT m.id, m.mode, m.ranked, mp.placement, mp.soaks, mp.rounds_won, mp.xp_earned, m.ended_at FROM matches m JOIN match_players mp ON mp.match_id = m.id WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT ?"
    )
    .all(playerId, limit) as any[];
}
