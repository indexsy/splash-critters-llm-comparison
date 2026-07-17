import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, GameMode, tierFor } from '@splash/shared';
import { MIGRATIONS } from './migrations.js';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db: Database.Database = new Database(path.join(DATA_DIR, 'splash.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function runMigrations(): void {
  const row = db.pragma('user_version', { simple: true }) as number;
  let version = row;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  version = MIGRATIONS.length;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
  custom_nickname: number;
  tutorial_done: number;
}

export interface RatingRow {
  player_id: string;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

const GUEST_NAMES = [
  'SoggyOtter', 'WetFrog', 'DampDuck', 'DrippyCat', 'SplashyPenguin',
  'SoggyRaccoon', 'MistyTurtle', 'BubblyCapy', 'SoakedSeal', 'RainyToad',
];

export function createGuest(): { player: PlayerRow; token: string } {
  const token = randomUUID();
  const id = randomUUID();
  const name = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]!;
  const tag = String(Math.floor(1000 + Math.random() * 9000));
  db.prepare(
    `INSERT INTO players (id, token_hash, nickname, tag, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, hashToken(token), name, tag, Date.now());
  for (const item of ['animal:frog', 'animal:duck', 'hat:none']) {
    db.prepare(`INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)`).run(id, item, Date.now());
  }
  return { player: getPlayer(id)!, token };
}

export function getPlayer(id: string): PlayerRow | undefined {
  return db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
}

export function getPlayerByToken(token: string): PlayerRow | undefined {
  return db.prepare(`SELECT * FROM players WHERE token_hash = ?`).get(hashToken(token)) as PlayerRow | undefined;
}

const PROFANITY = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'whore', 'slut', 'cock', 'pussy', 'nazi'];

export function nicknameClean(name: string): boolean {
  const lower = name.toLowerCase();
  return !PROFANITY.some((w) => lower.includes(w));
}

export function setNickname(playerId: string, nickname: string): { ok: boolean; tag?: string; error?: string } {
  if (!/^[\w \-]{3,16}$/.test(nickname)) return { ok: false, error: 'Nickname must be 3-16 letters, numbers, spaces, - or _' };
  if (!nicknameClean(nickname)) return { ok: false, error: 'Nickname not allowed' };
  const existing = db.prepare(`SELECT id FROM players WHERE nickname = ? AND id != ?`).get(nickname, playerId) as { id: string } | undefined;
  let tag: string;
  if (existing) {
    tag = String(Math.floor(1000 + Math.random() * 9000));
  } else {
    const current = getPlayer(playerId);
    tag = current?.tag ?? String(Math.floor(1000 + Math.random() * 9000));
  }
  db.prepare(`UPDATE players SET nickname = ?, tag = ?, custom_nickname = 1 WHERE id = ?`).run(nickname, tag, playerId);
  return { ok: true, tag };
}

export function setCosmetics(playerId: string, animal: string, hat: string): void {
  db.prepare(`UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?`).run(animal, hat, playerId);
}

export function markTutorialDone(playerId: string): void {
  db.prepare(`UPDATE players SET tutorial_done = 1 WHERE id = ?`).run(playerId);
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= CONFIG.xpForLevel(level)) {
    remaining -= CONFIG.xpForLevel(level);
    level++;
  }
  return level;
}

export function addXp(playerId: string, amount: number): { newXp: number; newLevel: number; leveledUp: boolean } {
  const p = getPlayer(playerId);
  if (!p) return { newXp: 0, newLevel: 1, leveledUp: false };
  const newXp = p.xp + amount;
  const newLevel = levelFromXp(newXp);
  const leveledUp = newLevel > p.level;
  db.prepare(`UPDATE players SET xp = ?, level = ? WHERE id = ?`).run(newXp, newLevel, playerId);
  if (leveledUp) {
    const now = Date.now();
    for (const a of CONFIG.ANIMALS) {
      if ((CONFIG.ANIMAL_UNLOCK_LEVEL[a] ?? 0) <= newLevel) {
        db.prepare(`INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)`).run(playerId, `animal:${a}`, now);
      }
    }
    for (const h of CONFIG.HATS) {
      if ((CONFIG.HAT_UNLOCK_LEVEL[h] ?? 0) <= newLevel) {
        db.prepare(`INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)`).run(playerId, `hat:${h}`, now);
      }
    }
  }
  return { newXp, newLevel, leveledUp };
}

export function getUnlocks(playerId: string): string[] {
  const rows = db.prepare(`SELECT item_id FROM unlocks WHERE player_id = ?`).all(playerId) as { item_id: string }[];
  return rows.map((r) => r.item_id);
}

export function getRating(playerId: string, mode: GameMode): RatingRow {
  let r = db.prepare(`SELECT * FROM ratings WHERE player_id = ? AND mode = ?`).get(playerId, mode) as RatingRow | undefined;
  if (!r) {
    db.prepare(`INSERT OR IGNORE INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 0, 0, ?)`).run(
      playerId,
      mode,
      CONFIG.ELO.START,
      CONFIG.ELO.START,
    );
    r = db.prepare(`SELECT * FROM ratings WHERE player_id = ? AND mode = ?`).get(playerId, mode) as RatingRow;
  }
  return r;
}

export function applyRatingChange(playerId: string, mode: GameMode, newRating: number, won: boolean): void {
  const r = getRating(playerId, mode);
  const peak = Math.max(r.peak, newRating);
  db.prepare(`UPDATE ratings SET rating = ?, games = games + 1, wins = wins + ?, peak = ? WHERE player_id = ? AND mode = ?`).run(
    newRating,
    won ? 1 : 0,
    peak,
    playerId,
    mode,
  );
}

export function createMatch(mode: GameMode, ranked: boolean): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO matches (id, mode, ranked, started_at) VALUES (?, ?, ?, ?)`).run(id, mode, ranked ? 1 : 0, Date.now());
  return id;
}

export interface MatchPlayerRecord {
  playerId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}

export function finishMatch(matchId: string, players: MatchPlayerRecord[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare(`UPDATE matches SET ended_at = ? WHERE id = ?`).run(Date.now(), matchId);
    for (const p of players) {
      stmt.run(matchId, p.playerId, p.placement, p.soaks, p.roundsWon, p.ratingBefore, p.ratingAfter, p.xpEarned);
    }
  })();
}

export function leaderboard(mode: GameMode, limit = 100) {
  const rows = db
    .prepare(
      `SELECT r.rating, r.games, r.wins, r.peak, p.id, p.nickname, p.tag
       FROM ratings r JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC LIMIT ?`,
    )
    .all(mode, limit) as { rating: number; games: number; wins: number; peak: number; id: string; nickname: string; tag: string }[];
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.id,
    nickname: r.nickname,
    tag: r.tag,
    rating: Math.round(r.rating),
    tier: tierFor(r.rating),
    games: r.games,
    winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
  }));
}

export function profileFor(playerId: string) {
  const p = getPlayer(playerId);
  if (!p) return null;
  const ratings = (['duel', 'ffa'] as GameMode[]).map((m) => {
    const r = getRating(playerId, m);
    return { mode: m, rating: Math.round(r.rating), games: r.games, wins: r.wins, peak: Math.round(r.peak) };
  });
  const recent = db
    .prepare(
      `SELECT mp.match_id, mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after, mp.xp_earned, m.mode, m.ranked, m.ended_at
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 10`,
    )
    .all(playerId);
  return {
    playerId: p.id,
    nickname: p.nickname,
    tag: p.tag,
    xp: p.xp,
    level: p.level,
    selectedAnimal: p.selected_animal,
    selectedHat: p.selected_hat,
    tutorialDone: p.tutorial_done === 1,
    customNickname: p.custom_nickname === 1,
    ratings,
    unlocks: getUnlocks(playerId),
    recentMatches: recent,
  };
}
