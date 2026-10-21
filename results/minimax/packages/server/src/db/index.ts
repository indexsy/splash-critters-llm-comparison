import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CONFIG, levelForXp, unlocksForLevel } from '@splash-critters/shared';
import { runMigrations } from './migrations.js';

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

export interface RatingRow {
  player_id: string;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface MatchPlayerRow {
  match_id: string;
  player_id: string;
  placement: number;
  soaks: number;
  rounds_won: number;
  rating_before: number | null;
  rating_after: number | null;
  xp_earned: number;
}

export interface PlayerRecord {
  id: string;
  nickname: string;
  tag: string;
  animal: string;
  hat: string;
  xp: number;
  level: number;
  createdAt: number;
  ratings: Record<string, { rating: number; games: number; wins: number; peak: number }>;
  unlocks: string[];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'splash.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const ADJECTIVES = [
  'Soggy', 'Splashing', 'Soaky', 'Drippy', 'Wobbly', 'Froggy', 'Sprout',
  'Bubbly', 'Splashy', 'Jelly', 'Bouncy', 'Quack', 'Ripple', 'Tide', 'Wave',
];
const CREATURES = [
  'Otter', 'Duck', 'Pup', 'Frog', 'Penguin', 'Cat', 'Raccoon', 'Turtle',
  'Capybara', 'Toad', 'Newt', 'Fin', 'Bun', 'Puffin', 'Kit', 'Cub',
];

export function randomNickname(): { nickname: string; tag: string } {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const creature = CREATURES[Math.floor(Math.random() * CREATURES.length)];
  const tag = String(Math.floor(1000 + Math.random() * 9000));
  return { nickname: `${adjective}${creature}`, tag };
}

export function createGuestPlayer(db: Database.Database): { player: PlayerRow; token: string } {
  const token = randomUUID();
  const { nickname, tag } = randomNickname();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO players (id, token_hash, nickname, tag, created_at, xp, level, selected_animal, selected_hat)
     VALUES (?, ?, ?, ?, ?, 0, 1, 'frog', 'none')`,
  ).run(id, hashToken(token), nickname, tag, now);
  for (const mode of ['duel', 'ffa']) {
    db.prepare(
      `INSERT OR IGNORE INTO ratings (player_id, mode, rating, games, wins, peak)
       VALUES (?, ?, ?, 0, 0, ?)`,
    ).run(id, mode, CONFIG.ELO.start, CONFIG.ELO.start);
  }
  const insertUnlock = db.prepare(
    'INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)',
  );
  for (const item of unlocksForLevel(1)) insertUnlock.run(id, item, now);
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow;
  return { player, token };
}

export function findPlayerByToken(db: Database.Database, token: string): PlayerRow | undefined {
  return db
    .prepare('SELECT * FROM players WHERE token_hash = ?')
    .get(hashToken(token)) as PlayerRow | undefined;
}

export function getPlayer(db: Database.Database, id: string): PlayerRow | undefined {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
}

export function setNickname(db: Database.Database, id: string, nickname: string): void {
  db.prepare('UPDATE players SET nickname = ?, level = ? WHERE id = ?').run(
    nickname,
    levelForXp(getPlayerXp(db, id)),
    id,
  );
}

export function getPlayerXp(db: Database.Database, id: string): number {
  const row = db.prepare('SELECT xp FROM players WHERE id = ?').get(id) as { xp: number } | undefined;
  return row?.xp ?? 0;
}

export function setCosmetics(
  db: Database.Database,
  id: string,
  animal: string,
  hat: string,
): void {
  db.prepare('UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?').run(
    animal,
    hat,
    id,
  );
}

export interface XpResult {
  xp: number;
  totalXp: number;
  level: number;
  levelUp: boolean;
  newUnlocks: string[];
}

export function addXp(db: Database.Database, id: string, amount: number): XpResult {
  const row = getPlayer(db, id);
  if (!row) return { xp: 0, totalXp: 0, level: 1, levelUp: false, newUnlocks: [] };
  const before = row.level;
  const totalXp = row.xp + amount;
  const level = levelForXp(totalXp);
  db.prepare('UPDATE players SET xp = ?, level = ? WHERE id = ?').run(totalXp, level, id);

  const owned = new Set(
    (db.prepare('SELECT item_id FROM unlocks WHERE player_id = ?').all(id) as { item_id: string }[]).map(
      (r) => r.item_id,
    ),
  );
  const newUnlocks: string[] = [];
  const insert = db.prepare(
    'INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)',
  );
  for (const item of unlocksForLevel(level)) {
    if (owned.has(item)) continue;
    insert.run(id, item, Date.now());
    owned.add(item);
    newUnlocks.push(item);
  }
  return { xp: amount, totalXp, level, levelUp: level > before, newUnlocks };
}

export function getUnlocks(db: Database.Database, id: string): string[] {
  const rows = db
    .prepare('SELECT item_id FROM unlocks WHERE player_id = ? ORDER BY item_id')
    .all(id) as { item_id: string }[];
  return rows.map((r) => r.item_id);
}

export interface RatingEntry {
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export function getRatings(db: Database.Database, id: string): Record<string, RatingEntry> {
  const rows = db.prepare('SELECT * FROM ratings WHERE player_id = ?').all(id) as RatingRow[];
  const out: Record<string, RatingEntry> = {};
  for (const mode of ['duel', 'ffa']) {
    const row = rows.find((r) => r.mode === mode);
    out[mode] = row
      ? { rating: row.rating, games: row.games, wins: row.wins, peak: row.peak }
      : { rating: CONFIG.ELO.start, games: 0, wins: 0, peak: CONFIG.ELO.start };
  }
  return out;
}

export function getRating(db: Database.Database, id: string, mode: string): RatingEntry {
  const row = db
    .prepare('SELECT * FROM ratings WHERE player_id = ? AND mode = ?')
    .get(id, mode) as RatingRow | undefined;
  return row
    ? { rating: row.rating, games: row.games, wins: row.wins, peak: row.peak }
    : { rating: CONFIG.ELO.start, games: 0, wins: 0, peak: CONFIG.ELO.start };
}

export function createMatch(
  db: Database.Database,
  id: string,
  mode: string,
  ranked: boolean,
  startedAt: number,
): void {
  db.prepare(
    'INSERT INTO matches (id, mode, ranked, started_at) VALUES (?, ?, ?, ?)',
  ).run(id, mode, ranked ? 1 : 0, startedAt);
}

export function finishMatch(db: Database.Database, id: string, endedAt: number): void {
  db.prepare('UPDATE matches SET ended_at = ? WHERE id = ?').run(endedAt, id);
}

export interface MatchPlayerInput {
  playerId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}

export function saveMatchPlayers(
  db: Database.Database,
  matchId: string,
  players: MatchPlayerInput[],
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO match_players
       (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: MatchPlayerInput[]) => {
    for (const r of rows) {
      stmt.run(
        matchId,
        r.playerId,
        r.placement,
        r.soaks,
        r.roundsWon,
        r.ratingBefore,
        r.ratingAfter,
        r.xpEarned,
      );
    }
  });
  tx(players);
}

export function updateRating(
  db: Database.Database,
  playerId: string,
  mode: string,
  ratingAfter: number,
  won: boolean,
): void {
  db.prepare(
    `UPDATE ratings
     SET rating = ?, games = games + 1, wins = wins + ?, peak = MAX(peak, ?)
     WHERE player_id = ? AND mode = ?`,
  ).run(ratingAfter, won ? 1 : 0, ratingAfter, playerId, mode);
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number;
  tier: string;
  animal: string;
}

export function leaderboard(db: Database.Database, mode: string, limit = 100): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.nickname, p.tag, p.selected_animal, r.rating, r.games, r.wins
       FROM ratings r JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC, r.games ASC
       LIMIT ?`,
    )
    .all(mode, limit) as {
    id: string;
    nickname: string;
    tag: string;
    selected_animal: string;
    rating: number;
    games: number;
    wins: number;
  }[];
  return rows.map((row, i) => ({
    rank: i + 1,
    playerId: row.id,
    nickname: row.nickname,
    tag: row.tag,
    animal: row.selected_animal,
    rating: row.rating,
    games: row.games,
    wins: row.wins,
    winRate: row.games > 0 ? row.wins / row.games : 0,
    tier: tierOf(row.rating),
  }));
}

function tierOf(rating: number): string {
  let name = CONFIG.TIERS[0].name;
  for (const tier of CONFIG.TIERS) if (rating >= tier.min) name = tier.name;
  return name;
}

export interface RecentMatch {
  matchId: string;
  mode: string;
  ranked: boolean;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  startedAt: number;
  endedAt: number | null;
}

export function recentMatches(db: Database.Database, playerId: string, limit = 10): RecentMatch[] {
  const rows = db
    .prepare(
      `SELECT mp.match_id, m.mode, m.ranked, mp.placement, mp.soaks, mp.rounds_won,
              mp.rating_before, mp.rating_after, mp.xp_earned, m.started_at, m.ended_at
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ?
       ORDER BY m.started_at DESC LIMIT ?`,
    )
    .all(playerId, limit) as {
    match_id: string;
    mode: string;
    ranked: number;
    placement: number;
    soaks: number;
    rounds_won: number;
    rating_before: number | null;
    rating_after: number | null;
    xp_earned: number;
    started_at: number;
    ended_at: number | null;
  }[];
  return rows.map((r) => ({
    matchId: r.match_id,
    mode: r.mode,
    ranked: r.ranked === 1,
    placement: r.placement,
    soaks: r.soaks,
    roundsWon: r.rounds_won,
    ratingBefore: r.rating_before,
    ratingAfter: r.rating_after,
    xpEarned: r.xp_earned,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }));
}

export function profile(db: Database.Database, id: string): PlayerRecord | undefined {
  const player = getPlayer(db, id);
  if (!player) return undefined;
  return {
    id: player.id,
    nickname: player.nickname,
    tag: player.tag,
    animal: player.selected_animal,
    hat: player.selected_hat,
    xp: player.xp,
    level: player.level,
    createdAt: player.created_at,
    ratings: getRatings(db, id),
    unlocks: getUnlocks(db, id),
  };
}
