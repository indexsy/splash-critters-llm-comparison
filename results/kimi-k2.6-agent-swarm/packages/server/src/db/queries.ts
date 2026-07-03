import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export type DatabaseInstance = InstanceType<typeof Database>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ───────────────── Row type interfaces ───────────────── */

export interface PlayerRow {
  id: number;
  token_hash: string;
  nickname: string | null;
  tag: string | null;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
}

export interface RatingRow {
  player_id: number;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface MatchRow {
  id: number;
  mode: string;
  ranked: number;
  started_at: number;
  ended_at: number | null;
}

export interface MatchPlayerRow {
  match_id: number;
  player_id: number;
  placement: number;
  soaks: number;
  rounds_won: number;
  rating_before: number | null;
  rating_after: number | null;
  xp_earned: number;
}

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  tag: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}

export interface ProfileRow {
  id: number;
  nickname: string | null;
  tag: string | null;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
  ratings: RatingRow[];
  unlocks: string[];
  recentMatches: RecentMatchRow[];
}

export interface RecentMatchRow {
  match_id: number;
  mode: string;
  ranked: boolean;
  started_at: number;
  ended_at: number | null;
  placement: number;
  soaks: number;
  rounds_won: number;
  rating_before: number | null;
  rating_after: number | null;
  xp_earned: number;
}

/* ───────────────── Helpers ───────────────── */

const ADJECTIVES = [
  'Soggy', 'Wet', 'Damp', 'Splashy', 'Drippy', 'Soaked', 'Misty', 'Frothy',
  'Bubbly', 'Chilly', 'Cool', 'Slippery', 'Sloppy', 'Squishy', 'Floaty',
];

const ANIMALS = [
  'Frog', 'Duck', 'Otter', 'Penguin', 'Cat', 'Raccoon', 'Turtle', 'Capybara',
  'Beaver', 'Seal', 'Fish', 'Tadpole', 'Newt', 'Salamander',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateNickname(): { nickname: string; tag: string } {
  const adj = ADJECTIVES[randomInt(0, ADJECTIVES.length - 1)];
  const animal = ANIMALS[randomInt(0, ANIMALS.length - 1)];
  const tag = String(randomInt(1000, 9999));
  return { nickname: `${adj}${animal}`, tag };
}

/** Tier bands from the game spec. */
function getTier(rating: number): string {
  if (rating < 1000) return 'Puddle';
  if (rating < 1150) return 'Pond';
  if (rating < 1300) return 'River';
  if (rating < 1500) return 'Lake';
  if (rating < 1750) return 'Ocean';
  return 'Tsunami';
}

/* ───────────────── Migrations ───────────────── */

function runMigrations(db: DatabaseInstance): void {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.exec(sql);
  }
}

/* ───────────────── Exported functions ───────────────── */

export function initDb(): DatabaseInstance {
  const dataDir = process.env.DATA_DIR ?? './data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'splash.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function createPlayer(
  db: DatabaseInstance,
  tokenHash: string
): { id: number; nickname: string; tag: string } {
  const { nickname, tag } = generateNickname();
  const stmt = db.prepare(
    `INSERT INTO players (token_hash, nickname, tag) VALUES (?, ?, ?)`
  );
  const result = stmt.run(tokenHash, nickname, tag);
  return { id: Number(result.lastInsertRowid), nickname, tag };
}

export function getPlayerByToken(
  db: DatabaseInstance,
  tokenHash: string
): PlayerRow | null {
  const stmt = db.prepare('SELECT * FROM players WHERE token_hash = ?');
  return (stmt.get(tokenHash) as PlayerRow | undefined) ?? null;
}

export function setNickname(
  db: DatabaseInstance,
  playerId: number,
  nickname: string,
  tag: string
): boolean {
  const check = db.prepare(
    'SELECT id FROM players WHERE nickname = ? AND tag = ? AND id != ?'
  );
  const existing = check.get(nickname, tag, playerId);
  if (existing) return false;

  const update = db.prepare(
    'UPDATE players SET nickname = ?, tag = ? WHERE id = ?'
  );
  const result = update.run(nickname, tag, playerId);
  return result.changes > 0;
}

export function getRatings(db: DatabaseInstance, playerId: number): RatingRow[] {
  const stmt = db.prepare('SELECT * FROM ratings WHERE player_id = ?');
  return stmt.all(playerId) as RatingRow[];
}

export function updateRatings(
  db: DatabaseInstance,
  playerId: number,
  mode: 'duel' | 'ffa',
  newRating: number,
  isWin: boolean
): void {
  const stmt = db.prepare(`
    INSERT INTO ratings (player_id, mode, rating, games, wins, peak)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(player_id, mode) DO UPDATE SET
      rating = excluded.rating,
      games = games + 1,
      wins = wins + excluded.wins,
      peak = MAX(peak, excluded.rating)
  `);
  stmt.run(playerId, mode, newRating, isWin ? 1 : 0, newRating);
}

export function createMatch(
  db: DatabaseInstance,
  mode: string,
  ranked: boolean
): number {
  const stmt = db.prepare(
    'INSERT INTO matches (mode, ranked, started_at) VALUES (?, ?, unixepoch())'
  );
  const result = stmt.run(mode, ranked ? 1 : 0);
  return Number(result.lastInsertRowid);
}

export function finishMatch(db: DatabaseInstance, matchId: number): void {
  const stmt = db.prepare('UPDATE matches SET ended_at = unixepoch() WHERE id = ?');
  stmt.run(matchId);
}

export function recordMatchPlayer(
  db: DatabaseInstance,
  matchId: number,
  playerId: number,
  placement: number,
  soaks: number,
  roundsWon: number,
  ratingBefore: number,
  ratingAfter: number,
  xpEarned: number
): void {
  const stmt = db.prepare(`
    INSERT INTO match_players
    (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    matchId,
    playerId,
    placement,
    soaks,
    roundsWon,
    ratingBefore,
    ratingAfter,
    xpEarned
  );
}

export function getLeaderboard(
  db: DatabaseInstance,
  mode: 'duel' | 'ffa',
  limit: number
): LeaderboardRow[] {
  const stmt = db.prepare(`
    SELECT
      p.nickname,
      p.tag,
      r.rating,
      r.games,
      r.wins
    FROM ratings r
    JOIN players p ON p.id = r.player_id
    WHERE r.mode = ?
    ORDER BY r.rating DESC, r.games ASC
    LIMIT ?
  `);
  const rows = stmt.all(mode, limit) as Array<{
    nickname: string | null;
    tag: string | null;
    rating: number;
    games: number;
    wins: number;
  }>;

  return rows.map((row, idx) => ({
    rank: idx + 1,
    nickname: row.nickname ?? 'Guest',
    tag: row.tag ?? '0000',
    rating: row.rating,
    tier: getTier(row.rating),
    games: row.games,
    winrate: row.games > 0 ? Math.round((row.wins / row.games) * 1000) / 10 : 0,
  }));
}

export function getProfile(
  db: DatabaseInstance,
  playerId: number
): ProfileRow | null {
  const playerStmt = db.prepare('SELECT * FROM players WHERE id = ?');
  const player = playerStmt.get(playerId) as PlayerRow | undefined;
  if (!player) return null;

  return {
    id: player.id,
    nickname: player.nickname,
    tag: player.tag,
    xp: player.xp,
    level: player.level,
    selected_animal: player.selected_animal,
    selected_hat: player.selected_hat,
    ratings: getRatings(db, playerId),
    unlocks: getUnlocks(db, playerId),
    recentMatches: getRecentMatches(db, playerId, 10),
  };
}

export function getRecentMatches(
  db: DatabaseInstance,
  playerId: number,
  limit: number
): RecentMatchRow[] {
  const stmt = db.prepare(`
    SELECT
      m.id AS match_id,
      m.mode,
      m.ranked,
      m.started_at,
      m.ended_at,
      mp.placement,
      mp.soaks,
      mp.rounds_won,
      mp.rating_before,
      mp.rating_after,
      mp.xp_earned
    FROM matches m
    JOIN match_players mp ON mp.match_id = m.id
    WHERE mp.player_id = ?
    ORDER BY m.started_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(playerId, limit) as Array<{
    match_id: number;
    mode: string;
    ranked: number;
    started_at: number;
    ended_at: number | null;
    placement: number;
    soaks: number;
    rounds_won: number;
    rating_before: number | null;
    rating_after: number | null;
    xp_earned: number;
  }>;

  return rows.map((row) => ({
    match_id: row.match_id,
    mode: row.mode,
    ranked: Boolean(row.ranked),
    started_at: row.started_at,
    ended_at: row.ended_at,
    placement: row.placement,
    soaks: row.soaks,
    rounds_won: row.rounds_won,
    rating_before: row.rating_before,
    rating_after: row.rating_after,
    xp_earned: row.xp_earned,
  }));
}

export function addUnlock(
  db: DatabaseInstance,
  playerId: number,
  itemId: string
): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO unlocks (player_id, item_id) VALUES (?, ?)'
  );
  stmt.run(playerId, itemId);
}

export function getUnlocks(db: DatabaseInstance, playerId: number): string[] {
  const stmt = db.prepare('SELECT item_id FROM unlocks WHERE player_id = ?');
  const rows = stmt.all(playerId) as Array<{ item_id: string }>;
  return rows.map((r) => r.item_id);
}
