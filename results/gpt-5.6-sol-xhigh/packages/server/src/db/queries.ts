import type Database from "better-sqlite3";
import { CONFIG, xpForLevel } from "@splash/shared";
import type { Animal, Hat, Mode, Profile } from "@splash/shared";

export interface PlayerRow {
  id: string;
  token_hash: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
  has_custom_nickname: number;
  created_at: number;
}

export interface RatingRow {
  player_id: string;
  mode: string;
  rating: number;
  games: number;
  wins: number;
  peak: number;
  updated_at: number;
}

const ANIMALS: readonly Animal[] = ["frog", "duck", "otter", "penguin", "cat", "raccoon", "turtle", "capybara"];

export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return level;
}

export function rowToProfile(row: PlayerRow): Profile {
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    xp: row.xp,
    level: row.level,
    selectedAnimal: row.selected_animal as Animal,
    selectedHat: row.selected_hat as Hat,
    hasCustomNickname: row.has_custom_nickname === 1
  };
}

export function createPlayer(db: Database.Database, id: string, tokenHash: string, nickname: string, tag: string, animal: Animal = "frog", hat: Hat = "none"): PlayerRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO players (id, token_hash, nickname, tag, xp, level, selected_animal, selected_hat, has_custom_nickname, created_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?, 0, ?)`
  ).run(id, tokenHash, nickname, tag, animal, hat, now);
  const unlock = db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)");
  unlock.run(id, "animal:frog", now);
  unlock.run(id, "animal:duck", now);
  unlock.run(id, "hat:none", now);
  return {
    id, token_hash: tokenHash, nickname, tag, xp: 0, level: 1, selected_animal: animal, selected_hat: hat, has_custom_nickname: 0, created_at: now
  };
}

export function getPlayerById(db: Database.Database, id: string): PlayerRow | undefined {
  return db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined;
}

export function getPlayerByToken(db: Database.Database, tokenHash: string): PlayerRow | undefined {
  return db.prepare("SELECT * FROM players WHERE token_hash = ?").get(tokenHash) as PlayerRow | undefined;
}

export function updateProfileCosmetics(db: Database.Database, id: string, animal: Animal, hat: Hat): void {
  db.prepare("UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?").run(animal, hat, id);
}

export function setNickname(db: Database.Database, id: string, nickname: string, tag: string): void {
  db.prepare("UPDATE players SET nickname = ?, tag = ?, has_custom_nickname = 1 WHERE id = ?").run(nickname, tag, id);
}

export function addXp(db: Database.Database, id: string, amount: number): { xp: number; level: number } {
  const row = getPlayerById(db, id);
  if (!row) return { xp: 0, level: 1 };
  const newXp = Math.max(0, row.xp + amount);
  const newLevel = levelForXp(newXp);
  db.prepare("UPDATE players SET xp = ?, level = ? WHERE id = ?").run(newXp, newLevel, id);
  const unlock = db.prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)");
  const now = Date.now();
  for (const [item, level] of Object.entries(CONFIG.UNLOCK_LEVELS.animals)) if (newLevel >= level) unlock.run(id, `animal:${item}`, now);
  for (const [item, level] of Object.entries(CONFIG.UNLOCK_LEVELS.hats)) if (newLevel >= level) unlock.run(id, `hat:${item}`, now);
  return { xp: newXp, level: newLevel };
}

export function getRating(db: Database.Database, playerId: string, mode: Mode): RatingRow {
  const existing = db.prepare("SELECT * FROM ratings WHERE player_id = ? AND mode = ?").get(playerId, mode) as RatingRow | undefined;
  if (existing) return existing;
  const now = Date.now();
  db.prepare("INSERT INTO ratings (player_id, mode, rating, games, wins, peak, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)")
    .run(playerId, mode, CONFIG.START_RATING, CONFIG.START_RATING, now);
  return { player_id: playerId, mode, rating: CONFIG.START_RATING, games: 0, wins: 0, peak: CONFIG.START_RATING, updated_at: now };
}

export function applyRatingResult(db: Database.Database, playerId: string, mode: Mode, before: number, after: number, won: boolean | null): void {
  const current = getRating(db, playerId, mode);
  const games = current.games + 1;
  const wins = current.wins + (won === true ? 1 : 0);
  db.prepare("UPDATE ratings SET rating = ?, games = ?, wins = ?, peak = MAX(peak, ?), updated_at = ? WHERE player_id = ? AND mode = ?")
    .run(after, games, wins, after, Date.now(), playerId, mode);
}

function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export function recordPairwise(db: Database.Database, playerA: string, playerB: string, mode: Mode, outcome: "a" | "b" | "draw"): void {
  const [lo, hi] = orderedPair(playerA, playerB);
  const aIsLo = lo === playerA;
  const row = db.prepare("SELECT * FROM pairwise_ratings WHERE player_a = ? AND player_b = ? AND mode = ?").get(lo, hi, mode) as
    | { games: number; wins_a: number; wins_b: number; draws: number }
    | undefined;
  const base = row ?? { games: 0, wins_a: 0, wins_b: 0, draws: 0 };
  const next = {
    games: base.games + 1,
    wins_a: base.wins_a + ((outcome === "a" && aIsLo) || (outcome === "b" && !aIsLo) ? 1 : 0),
    wins_b: base.wins_b + ((outcome === "b" && aIsLo) || (outcome === "a" && !aIsLo) ? 1 : 0),
    draws: base.draws + (outcome === "draw" ? 1 : 0)
  };
  db.prepare(
    `INSERT INTO pairwise_ratings (player_a, player_b, mode, games, wins_a, wins_b, draws) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_a, player_b, mode) DO UPDATE SET games = excluded.games, wins_a = excluded.wins_a, wins_b = excluded.wins_b, draws = excluded.draws`
  ).run(lo, hi, mode, next.games, next.wins_a, next.wins_b, next.draws);
}

export interface MatchRecordInput {
  playerId: string;
  bot: boolean;
  placement: number;
  roundsWon: number;
  soaks: number;
  castles: number;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  xpGained: number;
}

export function recordMatch(
  db: Database.Database,
  meta: { mode: Mode; ranked: boolean; roomCode: string; roundsToWin: number; theme: string; durationTicks: number },
  players: readonly MatchRecordInput[]
): number {
  const now = Date.now();
  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO matches (mode, ranked, started_at, ended_at, room_code, rounds_to_win, theme, duration_ticks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(meta.mode, meta.ranked ? 1 : 0, now - Math.round(meta.durationTicks / CONFIG.TICK_RATE * 1000), now, meta.roomCode, meta.roundsToWin, meta.theme, meta.durationTicks);
    const matchId = Number(info.lastInsertRowid);
    for (const p of players) {
      db.prepare(
        `INSERT INTO match_players (match_id, player_id, bot, placement, rounds_won, soaks, castles, rating_before, rating_after, rating_delta, xp_earned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(matchId, p.playerId, p.bot ? 1 : 0, p.placement, p.roundsWon, p.soaks, p.castles, p.ratingBefore, p.ratingAfter, p.ratingDelta, p.xpGained);
    }
    return matchId;
  });
  return tx();
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  tag: string;
  animal: string;
  level: number;
  rating: number;
  games: number;
  wins: number;
  tier: string;
}

export function getLeaderboard(db: Database.Database, mode: Mode, limit = 25): LeaderboardEntry[] {
  const rows = db.prepare(
    `SELECT p.id AS playerId, p.nickname AS nickname, p.tag AS tag, p.selected_animal AS animal, p.level AS level,
            r.rating AS rating, r.games AS games, r.wins AS wins
       FROM ratings r
       JOIN players p ON p.id = r.player_id
      WHERE r.mode = ? AND r.games > 0
      ORDER BY r.rating DESC
      LIMIT ?`
  ).all(mode, limit) as Array<{ playerId: string; nickname: string; tag: string; animal: string; level: number; rating: number; games: number; wins: number }>;
  return rows.map((r) => ({ ...r, tier: tierName(r.rating) }));
}

function tierName(rating: number): string {
  let name: string = CONFIG.TIERS[0]!.name;
  for (const band of CONFIG.TIERS) if (rating >= band.min) name = band.name;
  return name;
}

export function pickRandomAnimal(rng: () => number): Animal {
  return ANIMALS[Math.floor(rng() * ANIMALS.length)]!;
}
