// queries.ts — typed DB access for players, ratings, matches, unlocks.
import { getDb } from "./index.js";
import { ELO, tierFor, xpForLevel, DEFAULT_NICKNAME_ADJECTIVES, DEFAULT_NICKNAME_ANIMALS, type Animal, type GameMode, type Hat } from "@splash/shared";
import { createHash, randomBytes } from "node:crypto";
import { Rng } from "@splash/shared";

// ---------- players / accounts ----------

export function createPlayerForToken(token: string): PlayerRow {
  const db = getDb();
  const tokenHash = hashToken(token);
  const id = newId();
  // generated name like SoggyOtter#4821
  const rng = new Rng(Rng.hashStr(id));
  const adj = DEFAULT_NICKNAME_ADJECTIVES[rng.int(DEFAULT_NICKNAME_ADJECTIVES.length)];
  const animal = DEFAULT_NICKNAME_ANIMALS[rng.int(DEFAULT_NICKNAME_ANIMALS.length)];
  const tag = String(rng.range(1000, 9999));
  const nickname = `${adj}${animal}`;
  db.prepare(
    `INSERT INTO players (id, token_hash, nickname, tag) VALUES (?, ?, ?, ?)`,
  ).run(id, tokenHash, nickname, tag);
  return getPlayer(id)!;
}

export function findPlayerByToken(token: string): PlayerRow | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM players WHERE token_hash = ?")
    .get(hashToken(token)) as PlayerRow | undefined;
  return row;
}

export function getPlayer(id: string): PlayerRow | undefined {
  return getDb().prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined;
}

export function setNickname(id: string, nickname: string): { nickname: string; tag: string } {
  const db = getDb();
  const p = getPlayer(id);
  if (!p) throw new Error("no player");
  const clean = sanitizeNickname(nickname);
  db.prepare("UPDATE players SET nickname = ? WHERE id = ?").run(clean, id);
  return { nickname: clean, tag: p.tag ?? String(1000 + (hashStr32(id) % 9000)) };
}

export function setCosmetics(id: string, animal: Animal, hat: Hat): void {
  getDb()
    .prepare("UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?")
    .run(animal, hat, id);
}

export function addXp(id: string, xp: number): { level: number; xp: number; newUnlocks: string[] } {
  const db = getDb();
  const p = getPlayer(id);
  if (!p) throw new Error("no player");
  const beforeLevel = levelForXp(p.xp);
  const newXp = p.xp + xp;
  const afterLevel = levelForXp(newXp);
  const newUnlocks: string[] = [];
  if (afterLevel > beforeLevel) {
    const owned = new Set(getUnlocks(id).map((u) => u.item_id));
    for (const [item, info] of Object.entries(UNLOCKS)) {
      if (info.level <= afterLevel && !owned.has(item)) {
        grantUnlock(id, item);
        newUnlocks.push(item);
      }
    }
  }
  db.prepare("UPDATE players SET xp = ?, level = ? WHERE id = ?").run(newXp, afterLevel, id);
  return { level: afterLevel, xp: newXp, newUnlocks };
}

// ---------- ratings / elo ----------

export function getRating(playerId: string, mode: GameMode): RatingRow {
  const db = getDb();
  let row = db
    .prepare("SELECT * FROM ratings WHERE player_id = ? AND mode = ?")
    .get(playerId, mode) as RatingRow | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, 0, 0, ?)",
    ).run(playerId, mode, ELO.start, ELO.start);
    row = db
      .prepare("SELECT * FROM ratings WHERE player_id = ? AND mode = ?")
      .get(playerId, mode) as RatingRow;
  }
  return row;
}

export function applyRating(
  playerId: string,
  mode: GameMode,
  ratingAfter: number,
  won: boolean,
): RatingRow {
  const db = getDb();
  const cur = getRating(playerId, mode);
  const games = cur.games + 1;
  const wins = cur.wins + (won ? 1 : 0);
  const peak = Math.max(cur.peak, ratingAfter);
  db.prepare(
    "UPDATE ratings SET rating = ?, games = ?, wins = ?, peak = ? WHERE player_id = ? AND mode = ?",
  ).run(ratingAfter, games, wins, peak, playerId, mode);
  return { ...cur, rating: ratingAfter, games, wins, peak };
}

// ---------- matches ----------

export function recordMatchStart(matchId: string, mode: GameMode, ranked: boolean): void {
  getDb()
    .prepare("INSERT INTO matches (id, mode, ranked, started_at) VALUES (?, ?, ?, ?)")
    .run(matchId, mode, ranked ? 1 : 0, new Date().toISOString());
}

export function recordMatchEnd(matchId: string): void {
  getDb()
    .prepare("UPDATE matches SET ended_at = ? WHERE id = ?")
    .run(new Date().toISOString(), matchId);
}

export function recordMatchPlayer(
  matchId: string,
  playerId: string,
  placement: number,
  soaks: number,
  roundsWon: number,
  ratingBefore: number | null,
  ratingAfter: number | null,
  xpEarned: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(matchId, playerId, placement, soaks, roundsWon, ratingBefore, ratingAfter, xpEarned);
}

// ---------- unlocks ----------

export function getUnlocks(playerId: string): { player_id: string; item_id: string; unlocked_at: string }[] {
  return getDb().prepare("SELECT * FROM unlocks WHERE player_id = ?").all(playerId) as any;
}

export function grantUnlock(playerId: string, itemId: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id) VALUES (?, ?)")
    .run(playerId, itemId);
}

// ---------- leaderboards / profile ----------

export function leaderboard(mode: GameMode, limit = 100) {
  return getDb()
    .prepare(
      `SELECT r.player_id AS id, r.rating, r.games, r.wins, p.nickname, p.tag
         FROM ratings r JOIN players p ON p.id = r.player_id
        WHERE r.mode = ? AND r.games > 0
        ORDER BY r.rating DESC LIMIT ?`,
    )
    .all(mode, limit) as {
    id: string; rating: number; games: number; wins: number; nickname: string; tag: string;
  }[];
}

export function profile(id: string) {
  const p = getPlayer(id);
  if (!p) return undefined;
  const ratings = {
    duel: ratingView(p.id, "duel"),
    ffa: ratingView(p.id, "ffa"),
  };
  const recent = getDb()
    .prepare(
      `SELECT mp.match_id AS matchId, mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after, m.mode, m.ranked, m.ended_at
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
        WHERE mp.player_id = ?
        ORDER BY m.ended_at DESC LIMIT 10`,
    )
    .all(id) as any[];
  const unlocks = getUnlocks(id).map((u) => u.item_id);
  return {
    id: p.id,
    nickname: p.nickname,
    tag: p.tag,
    xp: p.xp,
    level: p.level,
    selectedAnimal: p.selected_animal,
    selectedHat: p.selected_hat,
    ratings,
    recent,
    unlocks,
  };
}

function ratingView(playerId: string, mode: GameMode) {
  const r = getRating(playerId, mode);
  return {
    mode,
    rating: r.rating,
    games: r.games,
    wins: r.wins,
    peak: r.peak,
    tier: tierFor(r.rating),
  };
}

// ---------- helpers ----------

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string | null;
  tag: string | null;
  created_at: string;
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

export function newId(): string {
  return randomBytes(12).toString("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashStr32(s: string): number {
  return Rng.hashStr(s);
}

function levelForXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level)) level++;
  return level;
}

function sanitizeNickname(n: string): string {
  // 3-16 chars, alnum + space + dash. Profanity filter is a stub (basic blocklist).
  const blocked = ["ass", "fuck", "shit", "cunt", "nigger", "retard"];
  let clean = n.trim().slice(0, 16);
  clean = clean.replace(/[^a-zA-Z0-9 \-]/g, "").slice(0, 16);
  if (clean.length < 3) clean = "Player";
  const lower = clean.toLowerCase();
  for (const b of blocked) {
    if (lower.includes(b)) clean = "Player";
  }
  return clean;
}

// local import to avoid cycle in config re-export
import { UNLOCKS } from "@splash/shared";
