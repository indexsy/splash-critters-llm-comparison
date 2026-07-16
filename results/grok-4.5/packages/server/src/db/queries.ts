import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CONFIG,
  levelFromXp,
  tierFromRating,
  totalXpForLevel,
  xpForLevel,
  type AnimalId,
  type GameMode,
  type HatId,
  type Profile,
} from '@splash/shared';
import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

const GUEST_NAMES = [
  'SoggyOtter', 'DampDuck', 'PuddleFrog', 'SplashCat', 'MistyPenguin',
  'DrizzleTurtle', 'BubblyCapy', 'SoakRaccoon', 'TidePod', 'Raindrop',
  'WetWhiskers', 'FoamFox', 'GullyGator', 'RippleRabbit', 'DewyDeer',
];

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'splash.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r: any) => r.id as number),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec(m.sql);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(m.id);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function genTag(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function genGuestName(): string {
  return GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]!;
}

export function createGuest(db: Db): { playerId: string; token: string; profile: Profile } {
  const token = randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const id = randomBytes(16).toString('hex');
  const nickname = genGuestName();
  let tag = genTag();
  // ensure unique
  for (let i = 0; i < 20; i++) {
    const exists = db.prepare('SELECT 1 FROM players WHERE nickname = ? AND tag = ?').get(nickname, tag);
    if (!exists) break;
    tag = genTag();
  }
  db.prepare(
    `INSERT INTO players (id, token_hash, nickname, tag, xp, level, selected_animal, selected_hat)
     VALUES (?, ?, ?, ?, 0, 1, 'frog', 'none')`,
  ).run(id, tokenHash, nickname, tag);

  for (const mode of ['duel', 'ffa'] as GameMode[]) {
    db.prepare(
      `INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 0, 0, ?)`,
    ).run(id, mode, CONFIG.ELO_START, CONFIG.ELO_START);
  }

  // Starter unlocks
  for (const item of ['animal:frog', 'animal:duck', 'hat:none']) {
    db.prepare(`INSERT INTO unlocks (player_id, item_id) VALUES (?, ?)`).run(id, item);
  }

  return { playerId: id, token, profile: getProfile(db, id)! };
}

export function findByToken(db: Db, token: string): Profile | null {
  const hash = hashToken(token);
  const row = db.prepare('SELECT id FROM players WHERE token_hash = ?').get(hash) as { id: string } | undefined;
  if (!row) return null;
  return getProfile(db, row.id);
}

export function getProfile(db: Db, playerId: string): Profile | null {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as any;
  if (!p) return null;
  const ratingsRows = db.prepare('SELECT * FROM ratings WHERE player_id = ?').all(playerId) as any[];
  const unlocks = (db.prepare('SELECT item_id FROM unlocks WHERE player_id = ?').all(playerId) as any[]).map(
    (r) => r.item_id as string,
  );
  const ratings: Profile['ratings'] = {
    duel: { rating: CONFIG.ELO_START, games: 0, wins: 0, peak: CONFIG.ELO_START },
    ffa: { rating: CONFIG.ELO_START, games: 0, wins: 0, peak: CONFIG.ELO_START },
  };
  for (const r of ratingsRows) {
    ratings[r.mode as GameMode] = {
      rating: r.rating,
      games: r.games,
      wins: r.wins,
      peak: r.peak,
    };
  }
  return {
    id: p.id,
    nickname: p.nickname,
    tag: p.tag,
    xp: p.xp,
    level: p.level,
    selectedAnimal: p.selected_animal as AnimalId,
    selectedHat: p.selected_hat as HatId,
    ratings,
    unlocks,
  };
}

const PROFANITY = ['fuck', 'shit', 'ass', 'bitch', 'nigger', 'faggot', 'cunt', 'dick', 'piss'];

export function setNickname(db: Db, playerId: string, nickname: string): { ok: true; profile: Profile } | { ok: false; error: string } {
  const nick = nickname.trim();
  if (nick.length < CONFIG.NICKNAME_MIN || nick.length > CONFIG.NICKNAME_MAX) {
    return { ok: false, error: `Nickname must be ${CONFIG.NICKNAME_MIN}–${CONFIG.NICKNAME_MAX} chars` };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(nick)) {
    return { ok: false, error: 'Letters, numbers, underscore only' };
  }
  const lower = nick.toLowerCase();
  if (PROFANITY.some((w) => lower.includes(w))) {
    return { ok: false, error: 'Nickname not allowed' };
  }
  const p = db.prepare('SELECT tag FROM players WHERE id = ?').get(playerId) as { tag: string } | undefined;
  if (!p) return { ok: false, error: 'Player not found' };

  // Keep same tag; check unique pair
  const clash = db
    .prepare('SELECT id FROM players WHERE nickname = ? AND tag = ? AND id != ?')
    .get(nick, p.tag, playerId);
  if (clash) {
    // new tag
    let tag = genTag();
    for (let i = 0; i < 30; i++) {
      if (!db.prepare('SELECT 1 FROM players WHERE nickname = ? AND tag = ?').get(nick, tag)) break;
      tag = genTag();
    }
    db.prepare('UPDATE players SET nickname = ?, tag = ? WHERE id = ?').run(nick, tag, playerId);
  } else {
    db.prepare('UPDATE players SET nickname = ? WHERE id = ?').run(nick, playerId);
  }
  return { ok: true, profile: getProfile(db, playerId)! };
}

export function setCosmetic(db: Db, playerId: string, animal: AnimalId, hat: HatId): Profile | null {
  const profile = getProfile(db, playerId);
  if (!profile) return null;
  const level = profile.level;
  const animalLevel = CONFIG.ANIMAL_UNLOCKS[animal];
  const hatLevel = CONFIG.HAT_UNLOCKS[hat];
  if (level < animalLevel || level < hatLevel) return profile;
  if (!profile.unlocks.includes(`animal:${animal}`) && animalLevel > 1) {
    // auto-unlock if level high enough
    unlockItem(db, playerId, `animal:${animal}`);
  }
  if (!profile.unlocks.includes(`hat:${hat}`) && hat !== 'none') {
    unlockItem(db, playerId, `hat:${hat}`);
  }
  db.prepare('UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?').run(animal, hat, playerId);
  return getProfile(db, playerId);
}

export function unlockItem(db: Db, playerId: string, itemId: string): void {
  db.prepare('INSERT OR IGNORE INTO unlocks (player_id, item_id) VALUES (?, ?)').run(playerId, itemId);
}

export function addXp(db: Db, playerId: string, amount: number): Profile {
  const p = db.prepare('SELECT xp, level FROM players WHERE id = ?').get(playerId) as { xp: number; level: number };
  let xp = p.xp + amount;
  let level = levelFromXp(xp);
  db.prepare('UPDATE players SET xp = ?, level = ? WHERE id = ?').run(xp, level, playerId);

  // Unlock items by level
  for (const [animal, lvl] of Object.entries(CONFIG.ANIMAL_UNLOCKS)) {
    if (level >= lvl) unlockItem(db, playerId, `animal:${animal}`);
  }
  for (const [hat, lvl] of Object.entries(CONFIG.HAT_UNLOCKS)) {
    if (level >= lvl) unlockItem(db, playerId, `hat:${hat}`);
  }
  return getProfile(db, playerId)!;
}

export function updateRating(
  db: Db,
  playerId: string,
  mode: GameMode,
  newRating: number,
  won: boolean,
): void {
  const row = db.prepare('SELECT * FROM ratings WHERE player_id = ? AND mode = ?').get(playerId, mode) as any;
  if (!row) {
    db.prepare(
      `INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(playerId, mode, newRating, won ? 1 : 0, newRating);
    return;
  }
  const peak = Math.max(row.peak, newRating);
  db.prepare(
    `UPDATE ratings SET rating = ?, games = games + 1, wins = wins + ?, peak = ? WHERE player_id = ? AND mode = ?`,
  ).run(newRating, won ? 1 : 0, peak, playerId, mode);
}

export function recordMatch(
  db: Db,
  matchId: string,
  mode: GameMode,
  ranked: boolean,
  players: Array<{
    playerId: string;
    placement: number;
    soaks: number;
    roundsWon: number;
    ratingBefore?: number;
    ratingAfter?: number;
    xpEarned: number;
  }>,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO matches (id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(matchId, mode, ranked ? 1 : 0, now, now);

  const ins = db.prepare(
    `INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of players) {
    // Skip pure bots (ids starting with bot-)
    if (p.playerId.startsWith('bot-')) continue;
    const exists = db.prepare('SELECT 1 FROM players WHERE id = ?').get(p.playerId);
    if (!exists) continue;
    ins.run(
      matchId,
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

export function getLeaderboard(db: Db, mode: GameMode, limit = 100) {
  const rows = db
    .prepare(
      `SELECT p.nickname, p.tag, r.rating, r.games, r.wins, r.peak
       FROM ratings r JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC LIMIT ?`,
    )
    .all(mode, limit) as any[];

  return rows.map((r, i) => ({
    rank: i + 1,
    nickname: `${r.nickname}#${r.tag}`,
    rating: r.rating,
    tier: tierFromRating(r.rating),
    games: r.games,
    winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
  }));
}

export function getRecentMatches(db: Db, playerId: string, limit = 10) {
  return db
    .prepare(
      `SELECT m.id, m.mode, m.ranked, m.ended_at, mp.placement, mp.soaks, mp.rounds_won,
              mp.rating_before, mp.rating_after, mp.xp_earned
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ?
       ORDER BY m.ended_at DESC LIMIT ?`,
    )
    .all(playerId, limit);
}
