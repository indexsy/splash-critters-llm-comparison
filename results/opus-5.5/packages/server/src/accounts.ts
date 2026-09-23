// Guest accounts and identity: device tokens, generated guest names, nickname claims (validated
// and profanity-filtered via moderation.ts), cosmetics, tutorial XP and the Profile / PublicProfile DTOs.
import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  ANIMAL_IDS,
  CONFIG,
  HAT_IDS,
  STARTER_UNLOCKS,
  cosmeticsUnlockedAtLevel,
  isAnimalId,
  isHatId,
  levelFromXp,
} from '@splash/shared';
import type { AnimalId, ErrorCode, HatId, Profile, PublicProfile, XpAward } from '@splash/shared';
import {
  addUnlocks,
  findPlayerByTokenHash,
  getPlayer,
  getRatingInfos,
  getRecentMatches,
  getUnlocks,
  insertPlayer,
  isNicknameTagTaken,
  markTutorialDone,
  setPlayerCosmetics,
  setPlayerNickname,
  takenTagsForNickname,
  type Db,
  type PlayerRecord,
} from './db';
import { impersonatesBot, impersonatesStaff, isProfane } from './moderation';
import { awardXp } from './progression';

/** A rejected account operation; `code` maps straight onto the protocol's `error` message. */
export class AccountError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export interface LoginResult {
  player: PlayerRecord;
  /** The token the client must keep (a fresh one if it sent none or an invalid one). */
  token: string;
  created: boolean;
}

export type NicknameCheck = { ok: true; value: string } | { ok: false; reason: string };

const DEFAULT_ANIMAL: AnimalId = 'frog';
const DEFAULT_HAT: HatId = 'none';
const RECENT_MATCHES_LIMIT = 10;
/** The tutorial arena seats the player in slot 0. */
const TUTORIAL_SLOT = 0;
const TAG_SPACE = 10_000;
const RANDOM_TAG_PROBES = 16;
const GUEST_NAME_ATTEMPTS = 20;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** SHA-256 hex digest: only the hash of a device token is ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomUUID();
}

/** UUID-ish device token: 16-64 chars of letters, digits, dash or underscore. */
export function validateToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

// ---------------------------------------------------------------------------
// Nickname validation
// ---------------------------------------------------------------------------

/**
 * Normalises and validates a nickname: trims, collapses whitespace runs to one space, then
 * requires NICK_MIN-NICK_MAX chars of ASCII letters/digits/space/underscore/dash with at least
 * one letter, not reserved and not profane (including leetspeak and separator obfuscation).
 */
export function validateNickname(raw: unknown): NicknameCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Nickname must be text.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < CONFIG.NICK_MIN || value.length > CONFIG.NICK_MAX) {
    return { ok: false, reason: `Nickname must be ${CONFIG.NICK_MIN} to ${CONFIG.NICK_MAX} characters.` };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(value)) {
    return { ok: false, reason: 'Use only letters, numbers, spaces, underscores and dashes.' };
  }
  if (!/[A-Za-z]/.test(value)) return { ok: false, reason: 'Nickname needs at least one letter.' };
  if (impersonatesBot(value) || impersonatesStaff(value)) return { ok: false, reason: 'That nickname is reserved.' };
  if (isProfane(value)) return { ok: false, reason: 'That nickname is not allowed. Keep it friendly!' };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Guest names + tags
// ---------------------------------------------------------------------------

export const GUEST_ADJECTIVES: readonly string[] = [
  'Soggy', 'Drippy', 'Splashy', 'Bubbly', 'Misty', 'Damp', 'Sudsy', 'Frothy', 'Wavy', 'Rainy',
  'Dewy', 'Foamy', 'Sloshy', 'Salty', 'Breezy', 'Zippy', 'Plucky', 'Bouncy', 'Fuzzy', 'Sneaky',
  'Cheeky', 'Jolly', 'Giggly', 'Speedy', 'Sunny', 'Snazzy', 'Wiggly', 'Squishy', 'Peppy', 'Dizzy',
  'Mellow', 'Sparkly',
];
export const GUEST_ANIMALS: readonly string[] = [
  'Otter', 'Frog', 'Duck', 'Penguin', 'Cat', 'Raccoon', 'Turtle', 'Capybara', 'Newt', 'Seal', 'Crab',
  'Beaver', 'Heron', 'Walrus', 'Axolotl', 'Toad', 'Goose', 'Puffin', 'Platypus', 'Salmon', 'Koi',
  'Shrimp', 'Narwhal', 'Manatee',
];

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}

function formatTag(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * A random 4-digit tag not yet used with this nickname (case-insensitive), or null if all
 * 10,000 are taken. Probes random tags first; enumerates the free ones only when crowded.
 */
function pickFreeTag(db: Db, nickname: string): string | null {
  for (let probe = 0; probe < RANDOM_TAG_PROBES; probe++) {
    const tag = formatTag(randomInt(TAG_SPACE));
    if (!isNicknameTagTaken(db, nickname, tag)) return tag;
  }
  const taken = takenTagsForNickname(db, nickname);
  const free = Array.from({ length: TAG_SPACE }, (_, n) => formatTag(n)).filter((tag) => !taken.has(tag));
  return free.length > 0 ? pick(free) : null;
}

/** A unique generated guest identity such as SoggyOtter#4821. */
export function generateGuestIdentity(db: Db): { nickname: string; tag: string } {
  for (let attempt = 0; attempt < GUEST_NAME_ATTEMPTS; attempt++) {
    const nickname = pick(GUEST_ADJECTIVES) + pick(GUEST_ANIMALS);
    const tag = pickFreeTag(db, nickname);
    if (tag) return { nickname, tag };
  }
  throw new Error('No free guest identity available');
}

// ---------------------------------------------------------------------------
// Login, nickname claims, cosmetics
// ---------------------------------------------------------------------------

function requirePlayer(db: Db, playerId: string): PlayerRecord {
  const player = getPlayer(db, playerId);
  if (!player) throw new AccountError('not_found', 'Player not found.');
  return player;
}

/** Creates a guest bound to `tokenHash`, owning the starter cosmetics. */
function createGuest(db: Db, tokenHash: string): PlayerRecord {
  return db.transaction((): PlayerRecord => {
    const { nickname, tag } = generateGuestIdentity(db);
    const id = randomUUID();
    const createdAt = Date.now();
    insertPlayer(db, { id, tokenHash, nickname, tag, createdAt, animal: DEFAULT_ANIMAL, hat: DEFAULT_HAT });
    addUnlocks(db, id, STARTER_UNLOCKS, createdAt);
    return requirePlayer(db, id);
  })();
}

/**
 * Resolves a device token to its player. A known token logs in; an unknown (valid) token gets a
 * new guest bound to it; a missing or malformed token gets a new guest with a fresh token.
 */
export function loginOrCreate(db: Db, token?: string | null): LoginResult {
  const usableToken = validateToken(token) ? token : newToken();
  const tokenHash = hashToken(usableToken);
  const existing = findPlayerByTokenHash(db, tokenHash);
  if (existing) return { player: existing, token: usableToken, created: false };
  return { player: createGuest(db, tokenHash), token: usableToken, created: true };
}

/**
 * Sets a validated nickname with a random free 4-digit tag and marks the player as named.
 * Re-claiming the current name (any casing) keeps the existing tag.
 * Throws AccountError 'nickname_invalid' | 'nickname_taken' | 'not_found'.
 */
export function claimNickname(db: Db, playerId: string, raw: unknown): Profile {
  const check = validateNickname(raw);
  if (!check.ok) throw new AccountError('nickname_invalid', check.reason);
  const nickname = check.value;
  db.transaction(() => {
    const player = requirePlayer(db, playerId);
    const sameName = player.nickname.toLowerCase() === nickname.toLowerCase();
    const tag = sameName ? player.tag : pickFreeTag(db, nickname);
    if (!tag) throw new AccountError('nickname_taken', 'That nickname is full. Try another one.');
    setPlayerNickname(db, playerId, nickname, tag);
  })();
  return buildProfile(db, playerId);
}

/** Cosmetics the player owns: stored unlocks plus everything their level grants, in catalogue order. */
function ownedCosmetics(db: Db, player: PlayerRecord): string[] {
  const owned = new Set([...getUnlocks(db, player.id), ...cosmeticsUnlockedAtLevel(levelFromXp(player.xp).level)]);
  return [...ANIMAL_IDS, ...HAT_IDS].filter((id) => owned.has(id));
}

/**
 * Selects an animal + hat. Throws AccountError 'invalid' for unknown ids, 'locked_item' for items
 * the player does not own, 'not_found' for an unknown player.
 */
export function setCosmetics(db: Db, playerId: string, animal: string, hat: string): Profile {
  if (!isAnimalId(animal) || !isHatId(hat)) throw new AccountError('invalid', 'Unknown animal or hat.');
  const owned = new Set(ownedCosmetics(db, requirePlayer(db, playerId)));
  if (!owned.has(animal) || !owned.has(hat)) throw new AccountError('locked_item', 'That item is still locked.');
  setPlayerCosmetics(db, playerId, animal, hat);
  return buildProfile(db, playerId);
}

// ---------------------------------------------------------------------------
// Profiles + tutorial
// ---------------------------------------------------------------------------

/** The owner's full profile. Throws AccountError 'not_found' for an unknown player. */
export function buildProfile(db: Db, playerId: string): Profile {
  const player = requirePlayer(db, playerId);
  const { level, xpIntoLevel, xpForNext } = levelFromXp(player.xp);
  return {
    id: player.id,
    nickname: player.nickname,
    tag: player.tag,
    hasNickname: player.hasNickname,
    xp: player.xp,
    level,
    xpIntoLevel,
    xpForNext,
    animal: player.animal,
    hat: player.hat,
    unlocks: ownedCosmetics(db, player),
    ratings: getRatingInfos(db, player.id),
    tutorialDone: player.tutorialDone,
    createdAt: player.createdAt,
  };
}

/** What anyone may see about a player (GET /api/profile/:id), or null if unknown. */
export function buildPublicProfile(db: Db, playerId: string): PublicProfile | null {
  const player = getPlayer(db, playerId);
  if (!player) return null;
  return {
    id: player.id,
    nickname: player.nickname,
    tag: player.tag,
    level: levelFromXp(player.xp).level,
    xp: player.xp,
    animal: player.animal,
    hat: player.hat,
    unlocks: ownedCosmetics(db, player),
    ratings: getRatingInfos(db, player.id),
    recentMatches: getRecentMatches(db, player.id, RECENT_MATCHES_LIMIT),
    createdAt: player.createdAt,
  };
}

/** Marks the tutorial done and awards CONFIG.XP.TUTORIAL the first time; null if it was already done. */
export function completeTutorial(db: Db, playerId: string): XpAward | null {
  requirePlayer(db, playerId);
  return db.transaction((): XpAward | null => {
    if (!markTutorialDone(db, playerId)) return null;
    const xp = CONFIG.XP.TUTORIAL;
    return awardXp(db, playerId, xp, [{ label: 'Tutorial complete', xp }], TUTORIAL_SLOT);
  })();
}

/** Marks the tutorial done without XP (the player skipped it). Returns false if it was already done. */
export function skipTutorial(db: Db, playerId: string): boolean {
  requirePlayer(db, playerId);
  return markTutorialDone(db, playerId);
}
