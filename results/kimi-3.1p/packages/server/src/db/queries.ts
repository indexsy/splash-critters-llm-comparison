import { createHash, randomInt, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { CONFIG, defaultRating, levelForXp, tierFor } from "@splash/shared";
import type { Animal, GameMode, Hat, PlayerProfile, RatingInfo } from "@splash/shared";

interface PlayerRow {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selected_animal: Animal;
  selected_hat: Hat;
  nickname_set: number;
  tutorial_completed: number;
}

export interface MatchPlayerRecord {
  accountId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  tutorialComplete?: boolean;
  ratingGames?: number;
  ratingWins?: number;
  ratingPeak?: number;
}

export interface MatchRecord {
  id: string;
  mode: GameMode;
  ranked: boolean;
  startedAt: number;
  endedAt: number;
  players: MatchPlayerRecord[];
}

export interface ProfileRecord {
  profile: PlayerProfile;
  ratings: RatingInfo[];
  recentMatches: {
    matchId: string;
    mode: GameMode;
    ranked: boolean;
    endedAt: number;
    placement: number;
    soaks: number;
    roundsWon: number;
    ratingBefore: number | null;
    ratingAfter: number | null;
    xpEarned: number;
  }[];
}

const FIRST_NAMES = ["Soggy", "Splashy", "Wobbly", "Drippy", "Bubbly", "Soaked", "Puddle", "Wavy"];
const ANIMAL_NAMES = ["Otter", "Frog", "Duck", "Penguin", "Cat", "Raccoon", "Turtle", "Capybara"];

export class SplashQueries {
  constructor(protected readonly database: Database.Database) {}

  close(): void {
    this.database.close();
  }

  private syncUnlocks(playerId: string, level: number): void {
    const insert = this.database.prepare("INSERT OR IGNORE INTO unlocks(player_id, item_id, unlocked_at) VALUES (?, ?, ?)");
    for (const [animal, required] of Object.entries(CONFIG.UNLOCKS.animals)) {
      if (level >= required) insert.run(playerId, `animal:${animal}`, Date.now());
    }
    for (const [hat, required] of Object.entries(CONFIG.UNLOCKS.hats)) {
      if (level >= required) insert.run(playerId, `hat:${hat}`, Date.now());
    }
  }

  getProfile(playerId: string): PlayerProfile | null {
    const row = this.database.prepare("SELECT * FROM players WHERE id = ?").get(playerId) as PlayerRow | undefined;
    if (!row) return null;
    this.syncUnlocks(row.id, row.level);
    const unlocks = this.database.prepare("SELECT item_id FROM unlocks WHERE player_id = ? ORDER BY unlocked_at").all(row.id) as { item_id: string }[];
    return {
      id: row.id,
      nickname: row.nickname,
      tag: row.tag,
      xp: row.xp,
      level: row.level,
      selectedAnimal: row.selected_animal,
      selectedHat: row.selected_hat,
      unlocks: unlocks.map((unlock) => unlock.item_id),
      nicknameSet: Boolean(row.nickname_set),
      tutorialComplete: Boolean(row.tutorial_completed)
    };
  }

  private createGuest(token: string): PlayerProfile {
    const id = randomUUID();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const nickname = `${FIRST_NAMES[randomInt(FIRST_NAMES.length)]}${ANIMAL_NAMES[randomInt(ANIMAL_NAMES.length)]}`;
      const tag = String(randomInt(1000, 10000));
      try {
        this.database.transaction(() => {
          this.database.prepare("INSERT INTO players(id, token_hash, nickname, tag, created_at) VALUES (?, ?, ?, ?, ?)").run(id, tokenHash, nickname, tag, now);
          const rating = this.database.prepare("INSERT INTO ratings(player_id, mode) VALUES (?, ?)");
          rating.run(id, "duel");
          rating.run(id, "ffa");
          const unlock = this.database.prepare("INSERT INTO unlocks(player_id, item_id, unlocked_at) VALUES (?, ?, ?)");
          unlock.run(id, "animal:frog", now);
          unlock.run(id, "animal:duck", now);
          unlock.run(id, "hat:none", now);
        })();
        const profile = this.getProfile(id);
        if (!profile) throw new Error("Guest creation failed");
        return profile;
      } catch (error) {
        if (attempt === 49 || !(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
      }
    }
    throw new Error("Unable to allocate guest name");
  }

  findOrCreateGuest(token?: string): { token: string; profile: PlayerProfile } {
    const candidate = token && /^[a-f0-9-]{36}$/i.test(token) ? token : randomUUID();
    const hash = createHash("sha256").update(candidate).digest("hex");
    const row = this.database.prepare("SELECT id FROM players WHERE token_hash = ?").get(hash) as { id: string } | undefined;
    if (row) {
      const profile = this.getProfile(row.id);
      if (profile) return { token: candidate, profile };
    }
    return { token: candidate, profile: this.createGuest(candidate) };
  }

  setNickname(playerId: string, nickname: string): PlayerProfile {
    const current = this.getProfile(playerId);
    if (!current) throw new Error("Unknown player");
    let tag = current.tag;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const conflict = this.database.prepare("SELECT id FROM players WHERE lower(nickname) = lower(?) AND tag = ? AND id != ?").get(nickname, tag, playerId);
      if (!conflict) {
        this.database.prepare("UPDATE players SET nickname = ?, tag = ?, nickname_set = 1 WHERE id = ?").run(nickname, tag, playerId);
        const profile = this.getProfile(playerId);
        if (!profile) throw new Error("Unknown player");
        return profile;
      }
      tag = String(randomInt(1000, 10000));
    }
    throw new Error("Unable to allocate nickname tag");
  }

  setCosmetics(playerId: string, animal: Animal, hat: Hat): PlayerProfile {
    const allowed = this.database.prepare("SELECT item_id FROM unlocks WHERE player_id = ? AND item_id IN (?, ?)").all(playerId, `animal:${animal}`, `hat:${hat}`) as { item_id: string }[];
    const unlocked = new Set(allowed.map((item) => item.item_id));
    if (!unlocked.has(`animal:${animal}`) || !unlocked.has(`hat:${hat}`)) throw new Error("Cosmetic is locked");
    this.database.prepare("UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?").run(animal, hat, playerId);
    const profile = this.getProfile(playerId);
    if (!profile) throw new Error("Unknown player");
    return profile;
  }

  getRating(playerId: string, mode: GameMode): RatingInfo {
    const row = this.database.prepare("SELECT mode, rating, games, wins, peak FROM ratings WHERE player_id = ? AND mode = ?").get(playerId, mode) as RatingInfo | undefined;
    return row ?? defaultRating(mode);
  }

  getRatings(playerId: string): RatingInfo[] {
    return [this.getRating(playerId, "duel"), this.getRating(playerId, "ffa")];
  }

  recordMatch(record: MatchRecord): void {
    const uniquePlayers = new Map<string, MatchPlayerRecord>();
    for (const player of record.players) {
      const existing = uniquePlayers.get(player.accountId);
      if (!existing) {
        uniquePlayers.set(player.accountId, { ...player, ratingGames: 1, ratingWins: player.placement === 1 ? 1 : 0, ratingPeak: player.ratingAfter ?? undefined });
      } else {
        existing.placement = Math.min(existing.placement, player.placement);
        existing.soaks += player.soaks;
        existing.roundsWon = Math.max(existing.roundsWon, player.roundsWon);
        existing.xpEarned += player.xpEarned;
        existing.ratingGames = (existing.ratingGames ?? 1) + 1;
        existing.ratingWins = (existing.ratingWins ?? 0) + (player.placement === 1 ? 1 : 0);
        if (existing.ratingAfter !== null && player.ratingAfter !== null && player.ratingBefore !== null) existing.ratingAfter += player.ratingAfter - player.ratingBefore;
        if (player.ratingAfter !== null) existing.ratingPeak = Math.max(existing.ratingPeak ?? player.ratingAfter, player.ratingAfter);
        existing.tutorialComplete = existing.tutorialComplete || player.tutorialComplete;
      }
    }
    this.database.transaction(() => {
      this.database.prepare("INSERT INTO matches(id, mode, ranked, started_at, ended_at) VALUES (?, ?, ?, ?, ?)").run(record.id, record.mode, record.ranked ? 1 : 0, record.startedAt, record.endedAt);
      const insert = this.database.prepare("INSERT INTO match_players(match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const updateRating = this.database.prepare("UPDATE ratings SET rating = ?, games = games + ?, wins = wins + ?, peak = max(peak, ?) WHERE player_id = ? AND mode = ?");
      const updatePlayer = this.database.prepare("UPDATE players SET xp = ?, level = ?, tutorial_completed = max(tutorial_completed, ?) WHERE id = ?");
      for (const player of uniquePlayers.values()) {
        insert.run(record.id, player.accountId, player.placement, player.soaks, player.roundsWon, player.ratingBefore, player.ratingAfter, player.xpEarned);
        if (record.ranked && player.ratingAfter !== null) {
          updateRating.run(player.ratingAfter, player.ratingGames ?? 1, player.ratingWins ?? (player.placement === 1 ? 1 : 0), player.ratingPeak ?? player.ratingAfter, player.accountId, record.mode);
        }
        const row = this.database.prepare("SELECT xp, level FROM players WHERE id = ?").get(player.accountId) as { xp: number; level: number } | undefined;
        if (!row) continue;
        const xp = row.xp + player.xpEarned;
        const level = levelForXp(xp);
        updatePlayer.run(xp, level, player.tutorialComplete ? 1 : 0, player.accountId);
        this.syncUnlocks(player.accountId, level);
      }
    })();
  }

  leaderboard(mode: GameMode) {
    const rows = this.database.prepare("SELECT p.id AS playerId, p.nickname, p.tag, r.rating, r.games, r.wins FROM ratings r JOIN players p ON p.id = r.player_id WHERE r.mode = ? AND r.games > 0 ORDER BY r.rating DESC, r.wins DESC, r.games ASC LIMIT 100").all(mode) as { playerId: string; nickname: string; tag: string; rating: number; games: number; wins: number }[];
    return rows.map((row, index) => ({
      rank: index + 1,
      playerId: row.playerId,
      nickname: `${row.nickname}#${row.tag}`,
      rating: row.rating,
      tier: tierFor(row.rating),
      games: row.games,
      winrate: row.games ? Math.round(row.wins / row.games * 1000) / 10 : 0
    }));
  }

  profileRecord(playerId: string): ProfileRecord | null {
    const profile = this.getProfile(playerId);
    if (!profile) return null;
    const recentMatches = this.database.prepare("SELECT m.id AS matchId, m.mode, m.ranked, m.ended_at AS endedAt, mp.placement, mp.soaks, mp.rounds_won AS roundsWon, mp.rating_before AS ratingBefore, mp.rating_after AS ratingAfter, mp.xp_earned AS xpEarned FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 10").all(playerId) as ProfileRecord["recentMatches"];
    return {
      profile,
      ratings: this.getRatings(playerId),
      recentMatches: recentMatches.map((match) => ({ ...match, ranked: Boolean(match.ranked) }))
    };
  }
}
