import type {
  AnimalId,
  HatId,
  Mode,
  Placement,
  RoundPhase,
  SimEvent,
  Theme,
} from './types.js';

/** Wire protocol for the Splash Critters websocket API. */

export interface PlayerProfile {
  id: string;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  xp: number;
  level: number;
  tier: string;
  ratingDuel: number;
  ratingFfa: number;
  gamesDuel: number;
  gamesFfa: number;
  unlocks: string[];
  hasNickname: boolean;
}

export interface RoomOptions {
  name: string;
  maxPlayers: 2 | 4;
  isPublic: boolean;
  theme: Theme | 'random';
  roundsToWin: number;
  botFill: boolean;
  /** Start the match right away (practice rooms). */
  autoStart?: boolean;
}

export interface RoomSlot {
  index: number;
  kind: 'empty' | 'human' | 'bot';
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  difficulty?: 'easy' | 'medium' | 'hard';
  playerId?: string;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  rating?: number;
}

export interface RoomInfo {
  id: string;
  code: string;
  name: string;
  maxPlayers: number;
  players: number;
  theme: Theme | 'random';
  roundsToWin: number;
  host: string;
  isPublic: boolean;
  inProgress: boolean;
}

export interface RoomState extends RoomInfo {
  slots: RoomSlot[];
  phase: 'lobby' | 'playing' | 'roundEnd' | 'matchEnd';
  ranked: boolean;
  rematchVotes: string[];
  countdown: number;
}

export interface SnapshotPlayer {
  id: number;
  animal: AnimalId;
  hat: HatId;
  nickname: string;
  tag: string;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  alive: boolean;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  biggestChain: number;
  duck: { x: number; y: number; dir: number } | null;
  isBot: boolean;
  lastSeq: number;
}

export interface SnapshotBalloon {
  id: number;
  owner: number;
  x: number;
  y: number;
  fuse: number;
  range: number;
  revenge: boolean;
  sliding: boolean;
  slideDir: number;
}

export interface SnapshotSplash {
  id: number;
  x: number;
  y: number;
  lens: [number, number, number, number];
  ticks: number;
  depth: number;
}

export interface SnapshotExposed {
  id: number;
  x: number;
  y: number;
  kind: string;
}

export interface Snapshot {
  tick: number;
  phase: RoundPhase;
  roundNo: number;
  countdown: number;
  timeLeft: number;
  tideRing: number;
  /** Compact castle grid, one character per tile ('0' or '1'). */
  castles: string;
  players: SnapshotPlayer[];
  balloons: SnapshotBalloon[];
  splashes: SnapshotSplash[];
  exposed: SnapshotExposed[];
  events: SimEvent[];
  serverTime: number;
}

export interface MatchConfigWire {
  mode: Mode;
  roundsToWin: number;
  theme: Theme | 'random';
  ranked: boolean;
  enableRevengeDucks: boolean;
  enableKick: boolean;
  players: {
    id: number;
    playerId?: string;
    nickname: string;
    tag: string;
    animal: AnimalId;
    hat: HatId;
    isBot: boolean;
    rating?: number;
    tier?: string;
  }[];
}

// ---------------------------------------------------------------------------
// client -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; token?: string }
  | { t: 'set_nickname'; nickname: string }
  | { t: 'queue_join'; mode: Mode }
  | { t: 'queue_leave' }
  | { t: 'create_room'; opts: RoomOptions }
  | { t: 'join_room'; code: string }
  | { t: 'room_list_request'; mode?: Mode }
  | { t: 'leave_room' }
  | { t: 'set_slot'; slot: number; kind: 'empty' | 'human' | 'bot'; difficulty?: 'easy' | 'medium' | 'hard' }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'set_cosmetics'; animal: AnimalId; hat: HatId }
  | { t: 'start_match' }
  | { t: 'input'; seq: number; tick: number; dir: number; balloon: boolean }
  | { t: 'emote'; id: number }
  | { t: 'rematch_vote' }
  | { t: 'pong'; ts: number };

// ---------------------------------------------------------------------------
// server -> client
// ---------------------------------------------------------------------------

export interface RatingDelta {
  playerId: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  tier: string;
  tierBefore: string;
}

export type ServerMessage =
  | { t: 'welcome'; playerId: string; profile: PlayerProfile; token: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'queue_status'; mode: Mode; eta: number; searchRange: number; queued: number; elapsedMs: number }
  | { t: 'match_found'; roomId: string; code: string; mode: Mode }
  | { t: 'room_created'; room: RoomState }
  | { t: 'room_list'; rooms: RoomInfo[] }
  | { t: 'lobby_state'; room: RoomState }
  | { t: 'match_start'; config: MatchConfigWire }
  | {
      t: 'round_start';
      roundNo: number;
      mapSeed: number;
      castleGrid: string;
      theme: Theme;
      config: MatchConfigWire;
    }
  | { t: 'snapshot'; snapshot: Snapshot }
  | { t: 'event'; event: SimEvent | { t: 'emote'; player: number; id: number } }
  | {
      t: 'round_end';
      roundNo: number;
      winners: number[];
      draw: boolean;
      scores: { id: number; nickname: string; tag: string; roundWins: number }[];
      nextInMs: number;
    }
  | {
      t: 'match_end';
      mode: Mode;
      ranked: boolean;
      placements: Placement[];
      ratingDeltas: RatingDelta[];
      xp: { playerId: string; xp: number; totalXp: number; level: number; levelUp: boolean }[];
      stats: { mostSoaks?: string; castleCrusher?: string; longestSurvivor?: string; biggestChain?: string };
    }
  | { t: 'ping'; ts: number; echo?: number }
  | { t: 'profile'; profile: PlayerProfile };

export const PROTOCOL_VERSION = 1;
