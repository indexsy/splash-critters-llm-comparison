import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { CONFIG, tierFor } from "@sc/shared";
import type { GameMode, PublicProfile } from "@sc/shared";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const ADJ = ["Soggy", "Ducky", "Splashy", "Wet", "Soaked", "Bubbly", "Drift", "Puddle", "Squirt", "Noodle"];
const NOUN = ["Otter", "Duck", "Frog", "Penguin", "Crab", "Turtle", "Beaver", "Seal", "Axolotl", "Capy"];

export function generateNickname(): { nickname: string; tag: string } {
  return {
    nickname: `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}`,
    tag: String(1000 + Math.floor(Math.random() * 9000)),
  };
}

const PROFANITY = ["fuck", "shit", "bitch", "cunt", "nigger", "faggot", "asshole", "dick", "cock", "pussy"];
export function cleanNickname(raw: string): string | null {
  const nick = raw.trim();
  if (nick.length < 3 || nick.length > 16) return null;
  if (!/^[\w\- ]+$/.test(nick)) return null;
  const lower = nick.toLowerCase();
  for (const word of PROFANITY) if (lower.includes(word)) return null;
  return nick;
}

export interface PlayerRow {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string | null;
  nickname_custom: number;
}

export class Queries {
  constructor(private db: Database.Database) {}

  createPlayer(token: string): PlayerRow {
    const id = crypto.randomUUID();
    const { nickname, tag } = generateNickname();
    this.db
      .prepare(
        "INSERT INTO players (id, token_hash, nickname, tag, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, hashToken(token), nickname, tag, Date.now());
    for (const mode of ["duel", "ffa"] as GameMode[]) {
      this.db
        .prepare("INSERT INTO ratings (player_id, mode) VALUES (?, ?)")
        .run(id, mode);
    }
    for (const animal of CONFIG.unlocks.startAnimals) {
      this.db
        .prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)")
        .run(id, `animal:${animal}`, Date.now());
    }
    return this.playerByToken(token)!;
  }

  playerByToken(token: string): PlayerRow | undefined {
    return this.db.prepare("SELECT * FROM players WHERE token_hash = ?").get(hashToken(token)) as
      | PlayerRow
      | undefined;
  }

  playerById(id: string): PlayerRow | undefined {
    return this.db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined;
  }

  setNickname(playerId: string, nickname: string): boolean {
    let tag = "";
    for (let i = 0; i < 20; i++) {
      tag = String(1000 + Math.floor(Math.random() * 9000));
      try {
        this.db
          .prepare("UPDATE players SET nickname = ?, tag = ?, nickname_custom = 1 WHERE id = ?")
          .run(nickname, tag, playerId);
        return true;
      } catch {
        // unique collision → retry with new tag
      }
    }
    return false;
  }

  rating(playerId: string, mode: GameMode): { rating: number; games: number; wins: number; peak: number } {
    return (
      (this.db
        .prepare("SELECT rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?")
        .get(playerId, mode) as { rating: number; games: number; wins: number; peak: number } | undefined) ?? {
        rating: CONFIG.eloStart,
        games: 0,
        wins: 0,
        peak: CONFIG.eloStart,
      }
    );
  }

  applyRating(
    playerId: string,
    mode: GameMode,
    before: number,
    after: number,
    won: boolean,
  ): void {
    this.db
      .prepare(
        `UPDATE ratings SET rating = ?, games = games + 1, wins = wins + ?, peak = MAX(peak, ?)
         WHERE player_id = ? AND mode = ?`,
      )
      .run(after, won ? 1 : 0, after, playerId, mode);
  }

  addXp(playerId: string, xp: number): { level: number; xp: number; leveledTo: number } {
    const row = this.db.prepare("SELECT xp, level FROM players WHERE id = ?").get(playerId) as {
      xp: number;
      level: number;
    };
    let xpTotal = row.xp + xp;
    let level = row.level;
    while (xpTotal >= xpForLevel(level)) {
      xpTotal -= xpForLevel(level);
      level++;
    }
    this.db.prepare("UPDATE players SET xp = ?, level = ? WHERE id = ?").run(xpTotal, level, playerId);
    return { level, xp: xpTotal, leveledTo: level };
  }

  setSelection(playerId: string, animal?: string, hat?: string | null): void {
    if (animal !== undefined)
      this.db.prepare("UPDATE players SET selected_animal = ? WHERE id = ?").run(animal, playerId);
    if (hat !== undefined)
      this.db.prepare("UPDATE players SET selected_hat = ? WHERE id = ?").run(hat, playerId);
  }

  unlocks(playerId: string): { animals: string[]; hats: string[] } {
    const rows = this.db
      .prepare("SELECT item_id FROM unlocks WHERE player_id = ?")
      .all(playerId) as Array<{ item_id: string }>;
    return {
      animals: rows.filter((r) => r.item_id.startsWith("animal:")).map((r) => r.item_id.slice(7)),
      hats: rows.filter((r) => r.item_id.startsWith("hat:")).map((r) => r.item_id.slice(4)),
    };
  }

  grantUnlock(playerId: string, kind: "animal" | "hat", id: string): boolean {
    const res = this.db
      .prepare("INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)")
      .run(playerId, `${kind}:${id}`, Date.now());
    return res.changes > 0;
  }

  unlockablesForLevel(level: number): { animals: string[]; hats: string[] } {
    const animals = Object.entries(CONFIG.unlocks.animalsByLevel)
      .filter(([, lv]) => lv <= level)
      .map(([id]) => id);
    const hats = Object.entries(CONFIG.unlocks.hatsByLevel)
      .filter(([, lv]) => lv <= level)
      .map(([id]) => id);
    return { animals, hats };
  }

  createMatch(mode: GameMode, ranked: boolean): string {
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO matches (id, mode, ranked, started_at) VALUES (?, ?, ?, ?)")
      .run(id, mode, ranked ? 1 : 0, Date.now());
    return id;
  }

  endMatch(matchId: string): void {
    this.db.prepare("UPDATE matches SET ended_at = ? WHERE id = ?").run(Date.now(), matchId);
  }

  recordMatchPlayer(
    matchId: string,
    playerId: string,
    placement: number,
    soaks: number,
    roundsWon: number,
    ratingBefore: number | null,
    ratingAfter: number | null,
    xpEarned: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(matchId, playerId, placement, soaks, roundsWon, ratingBefore, ratingAfter, xpEarned);
  }

  leaderboard(mode: GameMode): Array<{
    rank: number;
    nickname: string;
    tag: string;
    rating: number;
    tier: string;
    games: number;
    winrate: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.nickname, p.tag, r.rating, r.games, r.wins
         FROM ratings r JOIN players p ON p.id = r.player_id
         WHERE r.mode = ? AND r.games > 0
         ORDER BY r.rating DESC LIMIT 100`,
      )
      .all(mode) as Array<{ id: string; nickname: string; tag: string; rating: number; games: number; wins: number }>;
    return rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      tag: r.tag,
      rating: r.rating,
      tier: tierFor(r.rating),
      games: r.games,
      winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
    }));
  }

  profile(id: string): {
    player: PlayerRow;
    ratings: Record<string, { rating: number; games: number; wins: number; peak: number }>;
    recentMatches: Array<{
      matchId: string;
      mode: string;
      ranked: boolean;
      placement: number;
      soaks: number;
      roundsWon: number;
      ratingBefore: number | null;
      ratingAfter: number | null;
      xp: number;
      endedAt: number | null;
    }>;
    unlocks: { animals: string[]; hats: string[] };
  } | null {
    const player = this.playerById(id);
    if (!player) return null;
    const ratings: Record<string, { rating: number; games: number; wins: number; peak: number }> = {};
    for (const mode of ["duel", "ffa"]) {
      const row = this.db
        .prepare("SELECT rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?")
        .get(id, mode) as { rating: number; games: number; wins: number; peak: number } | undefined;
      if (row) ratings[mode] = row;
    }
    const recentMatches = (
      this.db
        .prepare(
          `SELECT m.id AS matchId, m.mode, m.ranked, m.ended_at AS endedAt,
                  mp.placement, mp.soaks, mp.rounds_won AS roundsWon,
                  mp.rating_before AS ratingBefore, mp.rating_after AS ratingAfter, mp.xp_earned AS xp
           FROM match_players mp JOIN matches m ON m.id = mp.match_id
           WHERE mp.player_id = ? ORDER BY m.started_at DESC LIMIT 20`,
        )
        .all(id) as Array<Record<string, unknown>>
    ).map((r) => ({ ...r, ranked: !!r.ranked })) as never;
    return { player, ratings, recentMatches, unlocks: this.unlocks(id) };
  }
}

export function xpForLevel(n: number): number {
  return CONFIG.levelCurveBase + CONFIG.levelCurveSlope * n;
}

export function publicProfile(row: PlayerRow, q: Queries): PublicProfile {
  const unlocks = q.unlocks(row.id);
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    level: row.level,
    xp: row.xp,
    xpForNext: xpForLevel(row.level),
    selectedAnimal: row.selected_animal,
    selectedHat: row.selected_hat,
    unlocks,
  };
}
