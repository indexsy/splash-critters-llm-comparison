/**
 * A room: the lobby people sit in, the slots they sit in, and the match those
 * slots turn into. Rooms know nothing about sockets or storage - the gateway
 * owns connections, `RoomManager` owns the collection, and a `PlayerLookup`
 * supplies whatever the room needs to name and rate the humans in it.
 */

import {
  CONFIG,
  botName,
  makeRng,
  maxPlayersForMode,
  randomSeed,
  tierForRating,
  type AnimalId,
  type BotDifficulty,
  type CreateRoomOpts,
  type GameMode,
  type HatId,
  type LobbyState,
  type MapTheme,
  type MatchPlayerInfo,
  type RatingInfo,
  type RoomSummary,
  type SlotInfo,
  type SlotKind,
} from '@splash/shared';
import type { PlayerRecord } from './players.js';
import type { MatchRunner } from './match.js';

/** The outcome of a slot edit: whether it happened, and who it displaced. */
export interface SlotChange {
  ok: boolean;
  evicted: string | null;
}

export type SlotOccupant =
  | { kind: 'open' }
  | { kind: 'human'; playerId: string; connected: boolean; disconnectedAt: number | null }
  | { kind: 'bot'; difficulty: BotDifficulty; name: string };

/** The slice of PlayerService a room needs. Keeps rooms testable without a DB. */
export interface PlayerLookup {
  getById(id: string): PlayerRecord | null;
  getRating(id: string, mode: GameMode): RatingInfo;
}

const DEFAULT_ROOM_NAME = 'Splash Room';
const BOT_TAG = 'BOT';
const DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

function sanitizeName(raw: string): string {
  const trimmed = raw.trim().slice(0, CONFIG.ROOM_NAME_MAX);
  return trimmed.length > 0 ? trimmed : DEFAULT_ROOM_NAME;
}

function sanitizeRounds(value: number, tutorial: boolean): number {
  if (CONFIG.ROUNDS_TO_WIN_OPTIONS.includes(value)) return value;
  // The tutorial is one scripted round rather than a match, so it is the single
  // caller allowed outside the options the create-room dialog offers.
  if (tutorial && value === CONFIG.TUTORIAL_ROUNDS_TO_WIN) return value;
  return CONFIG.DEFAULT_ROUNDS_TO_WIN;
}

function sanitizeDifficulty(value: BotDifficulty | undefined): BotDifficulty {
  return value !== undefined && DIFFICULTIES.includes(value) ? value : 'medium';
}

/** Bots deserve a look of their own, and the same bot must never flicker. */
function botAnimal(name: string, slot: number): AnimalId {
  let hash = slot * 31;
  for (let i = 0; i < name.length; i++) hash = (hash * 33 + name.charCodeAt(i)) >>> 0;
  return CONFIG.ANIMALS[hash % CONFIG.ANIMALS.length].id;
}

export class Room {
  readonly code: string;
  readonly mode: GameMode;
  readonly maxPlayers: number;
  readonly ranked: boolean;
  readonly tutorial: boolean;
  /** Practice and tutorial rooms skip the lobby entirely. */
  readonly autoStart: boolean;

  name: string;
  isPublic: boolean;
  theme: MapTheme | 'random';
  roundsToWin: number;
  botFill: boolean;
  hostPlayerId: string | null;
  slots: SlotOccupant[];
  phase: 'lobby' | 'match' | 'results' = 'lobby';
  match: MatchRunner | null = null;
  lastActivityAt: number;

  /** Players who have pressed Ready. Advisory only: the host starts the match. */
  readonly ready = new Set<string>();
  readonly rematchVotes = new Set<string>();

  /** Only ever used for bot names, so a plain unseeded stream is fine. */
  private readonly rng = makeRng(randomSeed());

  constructor(code: string, opts: CreateRoomOpts, ranked: boolean, hostPlayerId: string | null) {
    this.code = code;
    this.mode = opts.size === 2 ? 'duel' : 'ffa';
    this.maxPlayers = maxPlayersForMode(this.mode);
    this.ranked = ranked;
    this.tutorial = opts.tutorial === true;
    this.autoStart = opts.autoStart === true;

    this.name = sanitizeName(opts.name);
    // Ranked rooms belong to the matchmaker: never listed, never joinable by code.
    this.isPublic = ranked ? false : opts.isPublic;
    this.theme = opts.theme;
    this.roundsToWin = sanitizeRounds(opts.roundsToWin, this.tutorial);
    this.botFill = opts.botFill;
    this.hostPlayerId = ranked ? null : hostPlayerId;
    this.slots = Array.from({ length: this.maxPlayers }, () => ({ kind: 'open' }) as SlotOccupant);
    this.lastActivityAt = Date.now();
  }

  // ------------------------------------------------------------------- people

  /** Lowest open slot, or -1 when the room is full. Rejoining is idempotent. */
  addHuman(playerId: string): number {
    const existing = this.slotOfPlayer(playerId);
    if (existing >= 0) return existing;

    const slot = this.slots.findIndex((s) => s.kind === 'open');
    if (slot < 0) return -1;

    this.slots[slot] = { kind: 'human', playerId, connected: true, disconnectedAt: null };
    if (!this.ranked && this.hostPlayerId === null) this.hostPlayerId = playerId;
    this.lastActivityAt = Date.now();
    return slot;
  }

  removeHuman(playerId: string): void {
    const slot = this.slotOfPlayer(playerId);
    if (slot < 0) return;
    this.slots[slot] = { kind: 'open' };
    this.forget(playerId);
    this.lastActivityAt = Date.now();
  }

  slotOfPlayer(playerId: string): number {
    return this.slots.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
  }

  humanIds(): string[] {
    const ids: string[] = [];
    for (const slot of this.slots) if (slot.kind === 'human') ids.push(slot.playerId);
    return ids;
  }

  humanCount(): number {
    return this.humanIds().length;
  }

  occupiedCount(): number {
    return this.slots.reduce((n, slot) => (slot.kind === 'open' ? n : n + 1), 0);
  }

  /** Drop every trace of a player who is no longer in a slot. */
  private forget(playerId: string): void {
    this.ready.delete(playerId);
    this.rematchVotes.delete(playerId);
    if (this.hostPlayerId !== playerId) return;
    // The lowest remaining human inherits the room.
    this.hostPlayerId = this.humanIds()[0] ?? null;
  }

  // -------------------------------------------------------------------- slots

  /**
   * Host slot editing. A connected human can only leave under their own steam.
   * Returns the player who lost the seat, so whoever owns the room collection
   * can drop their membership too: a room-local forget is not enough.
   */
  setSlot(slot: number, kind: 'open' | 'bot', difficulty?: BotDifficulty): SlotChange {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.maxPlayers) {
      return { ok: false, evicted: null };
    }
    const current = this.slots[slot];
    if (current.kind === 'human' && current.connected) return { ok: false, evicted: null };
    const evicted = current.kind === 'human' ? current.playerId : null;

    if (kind === 'open') {
      this.slots[slot] = { kind: 'open' };
    } else {
      const level = sanitizeDifficulty(difficulty);
      this.slots[slot] = { kind: 'bot', difficulty: level, name: this.freshBotName(level) };
    }
    // Only once the seat is actually empty, or host promotion picks them again.
    if (evicted !== null) this.forget(evicted);
    this.lastActivityAt = Date.now();
    return { ok: true, evicted };
  }

  /** Tries for a name nobody else in the room is wearing, then settles. */
  private freshBotName(difficulty: BotDifficulty): string {
    const taken = new Set<string>();
    for (const occupant of this.slots) if (occupant.kind === 'bot') taken.add(occupant.name);
    for (let attempt = 0; attempt < 8; attempt++) {
      const name = botName(this.rng, difficulty);
      if (!taken.has(name)) return name;
    }
    return botName(this.rng, difficulty);
  }

  fillWithBots(difficulty: BotDifficulty = 'medium'): void {
    for (let slot = 0; slot < this.slots.length; slot++) {
      if (this.slots[slot].kind === 'open') this.setSlot(slot, 'bot', difficulty);
    }
  }

  canStart(): boolean {
    return this.phase !== 'match' && this.occupiedCount() >= 2;
  }

  /** Concrete every match, so a "random" room really does move around. */
  resolveTheme(): MapTheme {
    if (this.theme !== 'random') return this.theme;
    return CONFIG.THEMES[Math.floor(Math.random() * CONFIG.THEMES.length)].id;
  }

  // ------------------------------------------------------------------ views

  toSummary(lookup: PlayerLookup): RoomSummary {
    const host = this.hostPlayerId ? lookup.getById(this.hostPlayerId) : null;
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      players: this.occupiedCount(),
      maxPlayers: this.maxPlayers,
      theme: this.theme,
      hostName: host?.nickname ?? (this.ranked ? 'Matchmaker' : 'Host'),
      roundsToWin: this.roundsToWin,
      inProgress: this.phase !== 'lobby',
    };
  }

  toLobbyState(lookup: PlayerLookup): LobbyState {
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      theme: this.theme,
      roundsToWin: this.roundsToWin,
      isPublic: this.isPublic,
      botFill: this.botFill,
      ranked: this.ranked,
      hostSlot: this.hostPlayerId === null ? -1 : this.slotOfPlayer(this.hostPlayerId),
      slots: this.slots.map((_, slot) => this.toSlotInfo(slot, lookup)),
      phase: this.phase,
    };
  }

  private toSlotInfo(slot: number, lookup: PlayerLookup): SlotInfo {
    const occupant = this.slots[slot];
    const info = slotPlayerInfo(this, slot, lookup);

    if (occupant.kind === 'open' || info === null) {
      return {
        slot,
        kind: 'open',
        playerId: null,
        nickname: '',
        tag: '',
        animal: CONFIG.ANIMALS[0].id,
        hat: CONFIG.HATS[0].id,
        level: 0,
        ready: false,
        connected: false,
        difficulty: null,
        rating: null,
        tier: null,
      };
    }

    const kind: SlotKind = occupant.kind === 'human' ? 'human' : 'bot';
    return {
      slot,
      kind,
      playerId: info.playerId,
      nickname: info.nickname,
      tag: info.tag,
      animal: info.animal,
      hat: info.hat,
      level: info.level,
      // Bots are always ready, which is most of their charm.
      ready: occupant.kind === 'human' ? this.ready.has(occupant.playerId) : true,
      connected: occupant.kind === 'human' ? occupant.connected : true,
      difficulty: info.difficulty,
      rating: info.rating,
      tier: info.tier,
    };
  }

  touch(nowMs: number): void {
    this.lastActivityAt = nowMs;
  }
}

/**
 * How one slot presents itself in a match roster. Null for open slots. The
 * lobby view and MatchConfig both come from here so a critter never changes
 * face between the lobby and the whistle.
 */
export function slotPlayerInfo(
  room: Room,
  slot: number,
  lookup: PlayerLookup,
): MatchPlayerInfo | null {
  const occupant = room.slots[slot];
  if (occupant === undefined || occupant.kind === 'open') return null;

  if (occupant.kind === 'bot') {
    return {
      slot,
      playerId: null,
      nickname: occupant.name,
      tag: BOT_TAG,
      animal: botAnimal(occupant.name, slot),
      hat: CONFIG.HATS[0].id,
      level: 0,
      isBot: true,
      difficulty: occupant.difficulty,
      rating: null,
      tier: null,
    };
  }

  const record = lookup.getById(occupant.playerId);
  const rating = record ? lookup.getRating(occupant.playerId, room.mode).rating : null;
  return {
    slot,
    playerId: occupant.playerId,
    nickname: record?.nickname ?? 'Critter',
    tag: record?.tag ?? '0000',
    animal: (record?.selectedAnimal ?? CONFIG.ANIMALS[0].id) as AnimalId,
    hat: (record?.selectedHat ?? CONFIG.HATS[0].id) as HatId,
    level: record?.level ?? 1,
    isBot: false,
    difficulty: null,
    rating,
    tier: rating === null ? null : tierForRating(rating).id,
  };
}
