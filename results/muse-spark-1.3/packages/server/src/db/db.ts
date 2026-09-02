import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { CONFIG } from '@splash/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'splash.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function fallbackSql(): string {
  return `
  CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, nickname TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, selected_animal TEXT NOT NULL DEFAULT 'frog', selected_hat TEXT NOT NULL DEFAULT 'none');
  CREATE TABLE IF NOT EXISTS ratings (player_id TEXT NOT NULL, mode TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 1000, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, peak INTEGER NOT NULL DEFAULT 1000, PRIMARY KEY (player_id, mode));
  CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, mode TEXT NOT NULL, ranked INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, ended_at INTEGER);
  CREATE TABLE IF NOT EXISTS match_players (match_id TEXT NOT NULL, player_id TEXT NOT NULL, placement INTEGER NOT NULL, soaks INTEGER NOT NULL DEFAULT 0, rounds_won INTEGER NOT NULL DEFAULT 0, rating_before INTEGER, rating_after INTEGER, xp_earned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (match_id, player_id));
  CREATE TABLE IF NOT EXISTS unlocks (player_id TEXT NOT NULL, item_id TEXT NOT NULL, unlocked_at INTEGER NOT NULL, PRIMARY KEY (player_id, item_id));`;
}

export function runMigrations(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const done = new Set((db.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((r) => r.id));
  if (!done.has(1)) {
    let sql: string;
    try {
      sql = readFileSync(join(__dirname, '001_init.sql'), 'utf8');
    } catch {
      sql = fallbackSql();
    }
    db.exec(sql);
    db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (1, ?, ?)').run('001_init', Date.now());
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const ADJECTIVES = ['Soggy', 'Splashy', 'Damp', 'Derpy', 'Bubbly', 'Mossy', 'Wobbly', 'Puddly'];
const ANIMALS = ['Otter', 'Frog', 'Duck', 'Cat', 'Turtle', 'Newt', 'Axolotl', 'Capybara'];

export function genGuestName(): { nickname: string; tag: string } {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const tag = String(Math.floor(1000 + Math.random() * 9000));
  return { nickname: `${a}${b}`, tag };
}

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string;
  tag: string;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
}

export function createGuest(token: string): { player: PlayerRow; rawToken: string } {
  const raw = token || randomUUID();
  const { nickname, tag } = genGuestName();
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO players (id, token_hash, nickname, tag, created_at, xp, level) VALUES (?,?,?,?,?,?,?)').run(
    id, hashToken(raw), nickname, tag, now, 0, 1,
  );
  for (const mode of ['duel', 'ffa']) {
    db.prepare('INSERT OR IGNORE INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?,?,1000,0,0,1000)').run(id, mode);
  }
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(id) as PlayerRow;
  return { player, rawToken: raw };
}

export function getPlayerByTokenHash(h: string): PlayerRow | undefined {
  return db.prepare('SELECT * FROM players WHERE token_hash=?').get(h) as PlayerRow | undefined;
}

export function getPlayerById(id: string): PlayerRow | undefined {
  return db.prepare('SELECT * FROM players WHERE id=?').get(id) as PlayerRow | undefined;
}

const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'whore', 'slut', 'nazi', 'hitler'];
export function cleanNickname(n: string): string | null {
  const t = n.trim();
  if (t.length < 3 || t.length > 16) return null;
  if (!/^[A-Za-z0-9_ ]+$/.test(t)) return null;
  const low = t.toLowerCase();
  for (const b of BAD) if (low.includes(b)) return null;
  return t;
}

export function setNickname(id: string, nickname: string): { ok: boolean; msg?: string } {
  const clean = cleanNickname(nickname);
  if (!clean) return { ok: false, msg: 'Nickname must be 3-16 chars (letters/numbers/spaces) and clean.' };
  try {
    db.prepare('UPDATE players SET nickname=? WHERE id=?').run(clean, id);
    return { ok: true };
  } catch {
    return { ok: false, msg: 'Nickname taken or invalid.' };
  }
}

export function getRatings(playerId: string): Record<string, { rating: number; games: number; wins: number; peak: number }> {
  const rows = db.prepare('SELECT * FROM ratings WHERE player_id=?').all(playerId) as { mode: string; rating: number; games: number; wins: number; peak: number }[];
  const out: Record<string, { rating: number; games: number; wins: number; peak: number }> = {};
  for (const r of rows) out[r.mode] = { rating: r.rating, games: r.games, wins: r.wins, peak: r.peak };
  for (const m of ['duel', 'ffa']) if (!out[m]) out[m] = { rating: 1000, games: 0, wins: 0, peak: 1000 };
  return out;
}

export function updateRating(playerId: string, mode: string, after: number, won: boolean): void {
  const cur = db.prepare('SELECT * FROM ratings WHERE player_id=? AND mode=?').get(playerId, mode) as { rating: number; games: number; peak: number } | undefined;
  const games = (cur?.games ?? 0) + 1;
  const peak = Math.max(cur?.peak ?? 1000, after);
  db.prepare('INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?,?,?,?,?,?) ON CONFLICT(player_id, mode) DO UPDATE SET rating=excluded.rating, games=excluded.games, wins=ratings.wins+?, peak=excluded.peak')
    .run(playerId, mode, after, games, won ? 1 : 0, peak, won ? 1 : 0);
}

export function addXp(playerId: string, amount: number): { xp: number; level: number } {
  const p = getPlayerById(playerId);
  if (!p) return { xp: 0, level: 1 };
  let xp = p.xp + amount;
  let level = p.level;
  while (xp >= CONFIG.xpForLevel(level)) {
    xp -= CONFIG.xpForLevel(level);
    level++;
  }
  db.prepare('UPDATE players SET xp=?, level=? WHERE id=?').run(xp, level, playerId);
  return { xp, level };
}

export function setCosmetics(playerId: string, animal: string, hat: string): void {
  db.prepare('UPDATE players SET selected_animal=?, selected_hat=? WHERE id=?').run(animal, hat, playerId);
}

export function leaderboard(mode: string, limit = 100): { rank: number; playerId: string; nickname: string; tag: string; rating: number; games: number; wins: number; winrate: number }[] {
  const rows = db.prepare(
    `SELECT r.rating, r.games, r.wins, p.id, p.nickname, p.tag FROM ratings r JOIN players p ON p.id=r.player_id WHERE r.mode=? ORDER BY r.rating DESC LIMIT ?`,
  ).all(mode, limit) as { rating: number; games: number; wins: number; id: string; nickname: string; tag: string }[];
  return rows.map((r, i) => ({ rank: i + 1, playerId: r.id, nickname: r.nickname, tag: r.tag, rating: r.rating, games: r.games, wins: r.wins, winrate: r.games ? r.wins / r.games : 0 }));
}

export function recentMatches(playerId: string, limit = 10): unknown[] {
  return db.prepare(
    `SELECT mp.*, m.mode, m.ranked, m.started_at FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.player_id=? ORDER BY m.started_at DESC LIMIT ?`,
  ).all(playerId, limit);
}
