/**
 * Accounts, progression and match history.
 *
 * Players never sign up: the client keeps an opaque device token, we store only
 * its sha256, and every call is scoped by the account that token resolves to.
 * All gameplay numbers come from CONFIG so this file never invents a constant.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  CONFIG,
  generateGuestName,
  generateTag,
  levelFromXp,
  makeRng,
  randomSeed,
  tierForRating,
  validateNickname,
} from '@splash/shared';
import type {
  AnimalId,
  GameMode,
  HatId,
  LeaderboardRow,
  MatchHistoryRow,
  PlayerProfile,
  RatingInfo,
  Rng,
} from '@splash/shared';
import type { DB } from './db/index.js';
import type {
  LeaderboardQueryRow,
  MatchHistoryQueryRow,
  PlayerRow,
  Queries,
  RatingRow,
} from './db/queries.js';
import { createQueries } from './db/queries.js';

export interface PlayerRecord {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  tutorialDone: boolean;
  createdAt: number;
}

export interface MatchResultRow {
  playerId: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}

export interface RecordMatchInput {
  mode: GameMode;
  ranked: boolean;
  startedAt: number;
  endedAt: number;
  rows: MatchResultRow[];
}

export interface NicknameResult {
  ok: boolean;
  record?: PlayerRecord;
  code?: 'nickname_invalid' | 'nickname_taken';
  msg?: string;
}

export interface XpAward {
  record: PlayerRecord;
  levelBefore: number;
  levelAfter: number;
  unlocked: string[];
}

/** Tags run 0001..9999, matching generateTag() in shared. */
const TAG_COUNT = 9999;

/** Both modes are always present on a profile, even before the first game. */
const MODES: readonly GameMode[] = ['duel', 'ffa'];

/**
 * How many guest names to try before giving up. Each attempt scans all 9999
 * tags, so this only ever runs out with millions of accounts on one name.
 */
const GUEST_NAME_ATTEMPTS = 50;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toRecord(row: PlayerRow): PlayerRecord {
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    xp: row.xp,
    level: row.level,
    selectedAnimal: row.selected_animal as AnimalId,
    selectedHat: row.selected_hat as HatId,
    tutorialDone: row.tutorial_done !== 0,
    createdAt: row.created_at,
  };
}

function toRatingInfo(row: RatingRow): RatingInfo {
  return {
    mode: row.mode as GameMode,
    rating: row.rating,
    games: row.games,
    wins: row.wins,
    peak: row.peak,
  };
}

function toLeaderboardRow(row: LeaderboardQueryRow, index: number): LeaderboardRow {
  return {
    rank: index + 1,
    playerId: row.player_id,
    nickname: row.nickname,
    tag: row.tag,
    rating: row.rating,
    tier: tierForRating(row.rating).id,
    games: row.games,
    wins: row.wins,
    winrate: row.games > 0 ? row.wins / row.games : 0,
  };
}

function toHistoryRow(row: MatchHistoryQueryRow): MatchHistoryRow {
  return {
    matchId: row.match_id,
    mode: row.mode as GameMode,
    ranked: row.ranked !== 0,
    endedAt: row.ended_at,
    placement: row.placement,
    soaks: row.soaks,
    roundsWon: row.rounds_won,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    xpEarned: row.xp_earned,
  };
}

function formatTag(value: number): string {
  return String(value).padStart(4, '0');
}

/** Item ids are 'animal:otter' / 'hat:bucket' style. */
export class PlayerService {
  private readonly q: Queries;
  private readonly writeMatch: (id: string, input: RecordMatchInput) => void;

  constructor(db: DB) {
    this.q = createQueries(db);
    // One transaction so a half-written match can never show up in history.
    this.writeMatch = db.transaction((id: string, input: RecordMatchInput) => {
      this.q.insertMatch.run(id, input.mode, input.ranked ? 1 : 0, input.startedAt, input.endedAt);
      for (const row of input.rows) {
        this.q.insertMatchPlayer.run(
          id,
          row.playerId,
          row.placement,
          row.soaks,
          row.roundsWon,
          row.ratingBefore,
          row.ratingAfter,
          row.xpEarned,
        );
      }
    });
  }

  /** Existing account for the raw token, else a brand new guest. Returns the raw token to store client-side. */
  authenticate(token?: string): { record: PlayerRecord; token: string; isNew: boolean } {
    const existing = this.getByToken(token);
    if (existing !== null && token !== undefined) return { record: existing, token, isNew: false };
    return this.createGuest();
  }

  /**
   * The account a raw token belongs to, or null. Lets a caller find out whether
   * a hello would mint a brand new account before it commits to one.
   */
  getByToken(token?: string): PlayerRecord | null {
    if (!token) return null;
    const row = this.q.playerByTokenHash.get(hashToken(token));
    return row ? toRecord(row) : null;
  }

  getById(id: string): PlayerRecord | null {
    const row = this.q.playerById.get(id);
    return row ? toRecord(row) : null;
  }

  setNickname(id: string, nickname: string): NicknameResult {
    const check = validateNickname(nickname);
    if (!check.ok) return { ok: false, code: 'nickname_invalid', msg: check.reason };

    const current = this.getById(id);
    if (!current) return { ok: false, code: 'nickname_invalid', msg: 'Unknown player.' };

    const clean = nickname.trim();
    // Keeping the tag makes a rename feel free; only a collision moves it.
    const tag = this.allocateTag(clean, current.tag, id, makeRng(randomSeed()));
    if (!tag) {
      return { ok: false, code: 'nickname_taken', msg: 'That nickname is full. Try another.' };
    }

    this.q.updateNameTag.run(clean, tag, id);
    return { ok: true, record: { ...current, nickname: clean, tag } };
  }

  setCosmetics(id: string, animal: AnimalId, hat: HatId): PlayerRecord | null {
    const current = this.getById(id);
    if (!current) return null;
    this.q.updateCosmetics.run(animal, hat, id);
    return { ...current, selectedAnimal: animal, selectedHat: hat };
  }

  /** Idempotent. Grants CONFIG.XP_TUTORIAL the first time only. */
  setTutorialDone(id: string): XpAward {
    const record = this.requireRecord(id);
    if (record.tutorialDone) {
      return { record, levelBefore: record.level, levelAfter: record.level, unlocked: [] };
    }
    this.q.markTutorialDone.run(id);
    return this.awardXp(id, CONFIG.XP_TUTORIAL);
  }

  getRating(id: string, mode: GameMode): RatingInfo {
    const row = this.q.ratingFor.get(id, mode);
    if (row) return toRatingInfo(row);
    return {
      mode,
      rating: CONFIG.ELO_START,
      games: 0,
      wins: 0,
      peak: CONFIG.ELO_START,
    };
  }

  /** Bumps games, wins, peak and stores the new rating. */
  applyRating(id: string, mode: GameMode, rating: number, won: boolean): void {
    const clamped = Math.max(0, Math.round(rating));
    this.q.upsertRating.run(id, mode, clamped, won ? 1 : 0, clamped);
  }

  awardXp(id: string, xp: number): XpAward {
    const current = this.requireRecord(id);
    const gained = Math.max(0, Math.floor(xp));
    const total = current.xp + gained;
    // Derive both levels from XP rather than trusting the stored column, so a
    // stale level heals itself on the next award.
    const levelBefore = levelFromXp(current.xp).level;
    const levelAfter = levelFromXp(total).level;

    this.q.updateXp.run(total, levelAfter, id);
    const unlocked = this.grantUnlocks(id, levelAfter);
    return { record: this.requireRecord(id), levelBefore, levelAfter, unlocked };
  }

  getProfile(id: string): PlayerProfile | null {
    const record = this.getById(id);
    if (!record) return null;
    return {
      id: record.id,
      nickname: record.nickname,
      tag: record.tag,
      xp: record.xp,
      level: record.level,
      selectedAnimal: record.selectedAnimal,
      selectedHat: record.selectedHat,
      unlocks: this.q.unlocksFor.all(id).map((row) => row.item_id),
      ratings: MODES.map((mode) => this.getRating(id, mode)),
      tutorialDone: record.tutorialDone,
    };
  }

  recordMatch(input: RecordMatchInput): string {
    const id = randomUUID();
    this.writeMatch(id, input);
    return id;
  }

  getLeaderboard(mode: GameMode, limit: number): LeaderboardRow[] {
    const rows = this.q.leaderboard.all(mode, sanitizeLimit(limit));
    return rows.map(toLeaderboardRow);
  }

  getRecentMatches(id: string, limit: number): MatchHistoryRow[] {
    return this.q.recentMatches.all(id, sanitizeLimit(limit)).map(toHistoryRow);
  }

  /** Cosmetic ids a given level has earned, from CONFIG.ANIMALS / CONFIG.HATS. */
  unlockedItems(level: number): string[] {
    const animals = CONFIG.ANIMALS.filter((a) => a.unlockLevel <= level).map((a) => `animal:${a.id}`);
    const hats = CONFIG.HATS.filter((h) => h.unlockLevel <= level).map((h) => `hat:${h.id}`);
    return [...animals, ...hats];
  }

  // ------------------------------------------------------------------ internals

  private createGuest(): { record: PlayerRecord; token: string; isNew: boolean } {
    const rng = makeRng(randomSeed());
    const token = randomUUID();

    for (let attempt = 0; attempt < GUEST_NAME_ATTEMPTS; attempt++) {
      const nickname = generateGuestName(rng);
      const tag = this.allocateTag(nickname, generateTag(rng), '', rng);
      if (!tag) continue;

      const id = randomUUID();
      this.q.insertPlayer.run(id, hashToken(token), nickname, tag, Date.now());
      const record = this.requireRecord(id);
      // Level 1 cosmetics exist from the start, so seeding them here keeps the
      // first real award from reporting them as news.
      this.grantUnlocks(id, record.level);
      return { record, token, isNew: true };
    }

    throw new Error('could not allocate a free guest name');
  }

  /**
   * A tag for `nickname` that nobody else holds. Prefers `preferred`, otherwise
   * scans from a random offset so tags stay unguessable. Null when the name is
   * genuinely full.
   */
  private allocateTag(nickname: string, preferred: string, excludeId: string, rng: Rng): string | null {
    const taken = new Set(this.q.tagsForNickname.all(nickname, excludeId).map((row) => row.tag));
    if (!taken.has(preferred)) return preferred;
    if (taken.size >= TAG_COUNT) return null;

    const start = rng.range(1, TAG_COUNT);
    for (let i = 0; i < TAG_COUNT; i++) {
      const tag = formatTag(((start - 1 + i) % TAG_COUNT) + 1);
      if (!taken.has(tag)) return tag;
    }
    return null;
  }

  /** Writes any missing unlock rows for `level` and returns just the new ids. */
  private grantUnlocks(id: string, level: number): string[] {
    const now = Date.now();
    const fresh: string[] = [];
    for (const itemId of this.unlockedItems(level)) {
      const result = this.q.insertUnlock.run(id, itemId, now);
      if (result.changes > 0) fresh.push(itemId);
    }
    return fresh;
  }

  private requireRecord(id: string): PlayerRecord {
    const record = this.getById(id);
    if (!record) throw new Error(`unknown player: ${id}`);
    return record;
  }
}

function sanitizeLimit(limit: number): number {
  return Math.max(0, Math.floor(limit));
}
