import { createHash, randomUUID } from "node:crypto";
import {
  ANIMALS,
  CONFIG,
  HATS,
  levelForXp,
  tierForRating,
  type GameMode,
  type LeaderboardRow,
  type ProfileData,
  type ProfileResponse,
} from "../../../shared/src/index.js";
import { randomGuestName, randomTag } from "../names.js";
import { db } from "./index.js";

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
  has_custom_nickname: number;
  tutorial_done: number;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findPlayerByToken(token: string): PlayerRow | undefined {
  return db.prepare(`SELECT * FROM players WHERE token_hash = ?`).get(hashToken(token)) as
    | PlayerRow
    | undefined;
}

export function getPlayer(id: string): PlayerRow | undefined {
  return db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
}

export function createGuestPlayer(token: string): PlayerRow {
  const id = randomUUID();
  for (let attempt = 0; attempt < 50; attempt++) {
    const nickname = randomGuestName();
    const tag = randomTag();
    try {
      db.prepare(
        `INSERT INTO players (id, token_hash, nickname, tag, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(id, hashToken(token), nickname, tag, Date.now());
      seedDefaultUnlocks(id);
      return getPlayer(id)!;
    } catch (err: unknown) {
      if (String(err).includes("UNIQUE") && String(err).includes("nickname")) continue;
      throw err;
    }
  }
  throw new Error("could not allocate a guest name");
}

function seedDefaultUnlocks(playerId: string): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)`
  );
  for (const a of ANIMALS.filter((a) => a.unlockLevel <= 1)) stmt.run(playerId, `animal:${a.id}`, Date.now());
  for (const h of HATS.filter((h) => h.unlockLevel <= 1)) stmt.run(playerId, `hat:${h.id}`, Date.now());
}

/** Grant every unlock the player's level entitles them to; returns new item ids. */
export function syncUnlocks(playerId: string, level: number): string[] {
  const have = new Set(listUnlocks(playerId));
  const granted: string[] = [];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)`
  );
  for (const a of ANIMALS) {
    const id = `animal:${a.id}`;
    if (a.unlockLevel <= level && !have.has(id)) {
      stmt.run(playerId, id, Date.now());
      granted.push(id);
    }
  }
  for (const h of HATS) {
    const id = `hat:${h.id}`;
    if (h.unlockLevel <= level && !have.has(id)) {
      stmt.run(playerId, id, Date.now());
      granted.push(id);
    }
  }
  return granted;
}

export function listUnlocks(playerId: string): string[] {
  return (db.prepare(`SELECT item_id FROM unlocks WHERE player_id = ?`).all(playerId) as {
    item_id: string;
  }[]).map((r) => r.item_id);
}

export function setNickname(playerId: string, nickname: string): { ok: boolean; msg?: string } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const tag = randomTag();
    try {
      db.prepare(`UPDATE players SET nickname = ?, tag = ?, has_custom_nickname = 1 WHERE id = ?`).run(
        nickname,
        tag,
        playerId
      );
      return { ok: true };
    } catch (err: unknown) {
      if (String(err).includes("UNIQUE")) continue;
      throw err;
    }
  }
  return { ok: false, msg: "That name is very popular — try another." };
}

export function setCosmetics(playerId: string, animal: string, hat: string): void {
  const unlocked = new Set(listUnlocks(playerId));
  if (!unlocked.has(`animal:${animal}`) || !unlocked.has(`hat:${hat}`)) return;
  db.prepare(`UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?`).run(
    animal,
    hat,
    playerId
  );
}

export function setTutorialDone(playerId: string): void {
  db.prepare(`UPDATE players SET tutorial_done = 1 WHERE id = ?`).run(playerId);
}

export function addXp(playerId: string, amount: number): { xp: number; level: number; newUnlocks: string[] } {
  const row = getPlayer(playerId);
  if (!row) throw new Error("player not found");
  const xp = row.xp + amount;
  const level = levelForXp(xp);
  db.prepare(`UPDATE players SET xp = ?, level = ? WHERE id = ?`).run(xp, level, playerId);
  const newUnlocks = level > row.level ? syncUnlocks(playerId, level) : [];
  return { xp, level, newUnlocks };
}

// --- Ratings ---

export interface RatingRow {
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export function getRating(playerId: string, mode: GameMode): RatingRow {
  const row = db
    .prepare(`SELECT rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?`)
    .get(playerId, mode) as RatingRow | undefined;
  return row ?? { rating: CONFIG.ELO_START, games: 0, wins: 0, peak: CONFIG.ELO_START };
}

export function saveRating(playerId: string, mode: GameMode, r: RatingRow): void {
  db.prepare(
    `INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id, mode) DO UPDATE SET rating=excluded.rating, games=excluded.games, wins=excluded.wins, peak=excluded.peak`
  ).run(playerId, mode, r.rating, r.games, r.wins, r.peak);
}

// --- Matches ---

export function insertMatch(mode: GameMode, ranked: boolean, startedAt: number): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO matches (id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    mode,
    ranked ? 1 : 0,
    startedAt,
    Date.now()
  );
  return id;
}

export function insertMatchPlayer(
  matchId: string,
  playerId: string,
  placement: number,
  soaks: number,
  roundsWon: number,
  ratingBefore: number | null,
  ratingAfter: number | null,
  xpEarned: number
): void {
  db.prepare(
    `INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(matchId, playerId, placement, soaks, roundsWon, ratingBefore, ratingAfter, xpEarned);
}

// --- Read models ---

export function buildProfile(playerId: string): ProfileData | null {
  const row = getPlayer(playerId);
  if (!row) return null;
  const ratings = {
    duel: getRating(playerId, "duel"),
    ffa: getRating(playerId, "ffa"),
  };
  return {
    playerId: row.id,
    nickname: row.nickname,
    tag: `#${row.tag}`,
    xp: row.xp,
    level: row.level,
    selectedAnimal: row.selected_animal,
    selectedHat: row.selected_hat,
    unlocks: listUnlocks(playerId),
    ratings,
    hasCustomNickname: row.has_custom_nickname === 1,
    tutorialDone: row.tutorial_done === 1,
  };
}

export function leaderboard(mode: GameMode): LeaderboardRow[] {
  const rows = db
    .prepare(
      `SELECT r.player_id, r.rating, r.games, r.wins, p.nickname, p.tag
       FROM ratings r JOIN players p ON p.id = r.player_id
       WHERE r.mode = ? AND r.games > 0
       ORDER BY r.rating DESC, r.games DESC LIMIT 100`
    )
    .all(mode) as { player_id: string; rating: number; games: number; wins: number; nickname: string; tag: string }[];
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.player_id,
    nickname: `${r.nickname}#${r.tag}`,
    rating: r.rating,
    tier: tierForRating(r.rating),
    games: r.games,
    winrate: r.games > 0 ? r.wins / r.games : 0,
  }));
}

export function profileResponse(playerId: string): ProfileResponse | null {
  const row = getPlayer(playerId);
  if (!row) return null;
  const recent = db
    .prepare(
      `SELECT m.mode, m.ranked, m.ended_at, mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 10`
    )
    .all(playerId) as {
    mode: GameMode;
    ranked: number;
    ended_at: number;
    placement: number;
    soaks: number;
    rounds_won: number;
    rating_before: number | null;
    rating_after: number | null;
  }[];
  const withTier = (r: RatingRow) => ({ ...r, tier: tierForRating(r.rating) });
  return {
    playerId: row.id,
    nickname: `${row.nickname}#${row.tag}`,
    level: row.level,
    xp: row.xp,
    ratings: {
      duel: withTier(getRating(playerId, "duel")),
      ffa: withTier(getRating(playerId, "ffa")),
    },
    unlocks: listUnlocks(playerId),
    recentMatches: recent.map((r) => ({
      mode: r.mode,
      ranked: r.ranked === 1,
      placement: r.placement,
      soaks: r.soaks,
      roundsWon: r.rounds_won,
      ratingBefore: r.rating_before,
      ratingAfter: r.rating_after,
      endedAt: r.ended_at,
    })),
  };
}
