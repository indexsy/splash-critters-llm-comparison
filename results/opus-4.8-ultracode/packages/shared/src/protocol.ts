/**
 * Wire protocol — discriminated unions (`type` discriminant) plus the DTOs
 * exchanged over WebSocket and REST. Imported by both server and client.
 */

import type {
  AnimalId,
  Difficulty,
  Dir,
  HatId,
  MapTheme,
  Mode,
  PlayerInput,
  PowerUpType,
  SimEvent,
} from './types';

// ---- Account / profile DTOs ----

export interface RatingDTO {
  mode: Mode;
  rating: number;
  tier: string;
  tierName: string;
  games: number;
  wins: number;
  peak: number;
}

export interface ProfileDTO {
  id: string;
  nickname: string | null;
  tag: string | null;
  displayName: string; // "SoggyOtter#4821" or a fallback
  level: number;
  xp: number;
  xpInto: number;
  xpNeed: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  unlocks: string[]; // item ids (animals + hats) unlocked
  ratings: RatingDTO[];
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  rating: number;
  tier: string;
  tierName: string;
  games: number;
  wins: number;
  winrate: number;
}

export interface RecentMatchDTO {
  matchId: number;
  mode: Mode;
  ranked: boolean;
  placement: number;
  soaks: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  endedAt: number;
}

// ---- Lobby / room DTOs ----

export interface CreateRoomOpts {
  name: string;
  mode: Mode;
  isPublic: boolean;
  theme: MapTheme | 'random';
  roundsToWin: number;
  botFill: boolean;
}

export interface RoomListItem {
  code: string;
  name: string;
  mode: Mode;
  players: number;
  max: number;
  theme: MapTheme | 'random';
  host: string;
  inProgress: boolean;
}

export type SlotKind = 'empty' | 'human' | 'bot' | 'closed';

export interface SlotState {
  index: number;
  kind: SlotKind;
  playerId?: string;
  name?: string;
  animal?: AnimalId;
  hat?: HatId;
  ready: boolean;
  isHost: boolean;
  difficulty?: Difficulty;
  connected: boolean;
}

export type LobbyPhase = 'lobby' | 'countdown' | 'in_match' | 'results';

export interface LobbyState {
  code: string;
  name: string;
  mode: Mode;
  theme: MapTheme | 'random';
  roundsToWin: number;
  isPublic: boolean;
  botFill: boolean;
  ranked: boolean;
  practice: boolean;
  hostId: string;
  phase: LobbyPhase;
  slots: SlotState[];
  rematchVotes: number;
  rematchNeeded: number;
}

// ---- Match / round DTOs ----

export interface RoundPlayerDTO {
  id: string;
  slot: number;
  name: string;
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  botDifficulty?: Difficulty;
  rating?: number;
  level?: number;
}

export interface MatchConfig {
  mode: Mode;
  ranked: boolean;
  roundsToWin: number;
  theme: MapTheme;
  revengeEnabled: boolean;
  players: RoundPlayerDTO[];
}

// ---- Snapshot (15Hz authoritative dynamic state) ----

export interface PlayerSnap {
  id: string;
  slot: number;
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
  alive: boolean;
  activeBalloons: number;
  maxBalloons: number;
  range: number;
  speed: number;
  hasKick: boolean;
  soaks: number;
  castlesWashed: number;
  roundWins: number;
  revenge: boolean;
  emoteId: number;
  emoteUntilTick: number;
  connected: boolean;
}

export interface BalloonSnap {
  id: number;
  owner: string;
  x: number;
  y: number;
  fuseTick: number;
  range: number;
  sliding: Dir | null;
}

export interface SplashSnap {
  x: number;
  y: number;
  expiresTick: number;
  ownerSlot: number;
  center: boolean;
}

export interface LobSnap {
  id: number;
  x: number;
  y: number;
  dir: Dir;
}

export interface Snapshot {
  tick: number;
  serverTimeMs: number;
  players: PlayerSnap[];
  balloons: BalloonSnap[];
  splashes: SplashSnap[];
  powerups: { x: number; y: number; type: PowerUpType }[];
  revengeLobs: LobSnap[];
  tideLevel: number;
}

export interface RoundScore {
  slot: number;
  roundWins: number;
}

export interface PlacementDTO {
  slot: number;
  playerId: string;
  name: string;
  animal: AnimalId;
  placement: number;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  tierName?: string;
  xpEarned: number;
  levelBefore: number;
  levelAfter: number;
}

export interface AwardDTO {
  label: string; // "Most Soaks", "Castle Crusher", "Longest Survivor", "Biggest Chain"
  playerId: string;
  name: string;
  value: number;
}

export interface MatchResult {
  mode: Mode;
  ranked: boolean;
  placements: PlacementDTO[];
  awards: AwardDTO[];
}

// ---- Client -> Server ----

export type ClientMsg =
  | { type: 'hello'; token?: string }
  | { type: 'set_nickname'; name: string }
  | { type: 'set_loadout'; animal: AnimalId; hat: HatId }
  | { type: 'queue_join'; mode: Mode }
  | { type: 'queue_leave' }
  | { type: 'create_room'; opts: CreateRoomOpts }
  | { type: 'join_room'; code: string }
  | { type: 'room_list_request'; mode?: Mode | 'all' }
  | { type: 'leave_room' }
  | { type: 'set_slot'; slot: number; kind: 'open' | 'bot' | 'closed'; difficulty?: Difficulty }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_match' }
  | { type: 'practice'; mode: Mode; bots: Difficulty[] }
  | { type: 'input'; inputs: PlayerInput[] }
  | { type: 'emote'; id: number }
  | { type: 'rematch_vote'; vote: boolean }
  | { type: 'tutorial_done' }
  | { type: 'pong'; t: number };

// ---- Server -> Client ----

export type ServerMsg =
  | { type: 'welcome'; profile: ProfileDTO; token: string }
  | { type: 'profile'; profile: ProfileDTO }
  | { type: 'error'; code: string; msg: string }
  | { type: 'queue_status'; mode: Mode; eta: number; searchRange: number; elapsed: number; size: number }
  | { type: 'match_found'; code: string; mode: Mode; ranked: boolean }
  | { type: 'room_created'; code: string }
  | { type: 'room_list'; rooms: RoomListItem[] }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'match_start'; config: MatchConfig }
  | {
      type: 'round_start';
      roundNo: number;
      mapSeed: number;
      theme: MapTheme;
      startAtTick: number;
      players: RoundPlayerDTO[];
    }
  | { type: 'snapshot'; snap: Snapshot }
  | { type: 'event'; tick: number; events: SimEvent[] }
  | { type: 'round_end'; roundNo: number; winnerSlot: number | null; scores: RoundScore[] }
  | { type: 'match_end'; result: MatchResult }
  | { type: 'xp_award'; xp: number; level: number; leveledUp: boolean; unlocked: string[] }
  | { type: 'ping'; t: number };

export const ERR = {
  RATE_LIMIT: 'rate_limit',
  BAD_MSG: 'bad_msg',
  NO_ROOM: 'no_room',
  ROOM_FULL: 'room_full',
  NOT_HOST: 'not_host',
  NEED_NICK: 'need_nickname',
  IN_MATCH: 'in_match',
  BAD_NICK: 'bad_nickname',
  NICK_TAKEN: 'nickname_taken',
} as const;
