// Wire protocol: JSON messages over one WebSocket at /ws. Discriminant key is `type`
// (so `ping{t}` / `pong{t}` can carry a timestamp named `t`, as in the spec).
import type {
  AnimalId,
  CreateRoomOpts,
  Difficulty,
  DirCode,
  EmoteId,
  FunStat,
  GameEvent,
  HatId,
  ItemSnap,
  LobbyState,
  MatchConfig,
  MatchPlayerInfo,
  Mode,
  PlacementEntry,
  PlayerRoundSummary,
  PlayerSnap,
  Profile,
  RatingDelta,
  RoomSummary,
  Splash,
  Theme,
  XpAward,
} from './types';

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

/**
 * One client tick of input (sampled at 60 Hz, sent at 30 Hz), with the field names of spec
 * section 8. `tick` = the client's estimate of the server tick.
 */
export interface InputMsg {
  type: 'input';
  seq: number;
  tick: number;
  dir: DirCode;
  balloonPressed: boolean;
}

/** Every client message. */
export type C2S =
  | { type: 'hello'; token?: string; v: number }
  | { type: 'set_nickname'; nickname: string }
  | { type: 'set_cosmetics'; animal: AnimalId; hat: HatId }
  | { type: 'tutorial_start' }
  | { type: 'tutorial_skip' }
  | { type: 'queue_join'; mode: Mode }
  | { type: 'queue_leave' }
  | { type: 'create_room'; opts: CreateRoomOpts }
  | { type: 'join_room'; code: string }
  | { type: 'room_list_request'; mode?: Mode }
  /** Subscribe/unsubscribe to live room_list pushes while the browser screen is open. */
  | { type: 'room_list_watch'; on: boolean }
  | { type: 'leave_room' }
  | { type: 'set_slot'; slot: number; kind: 'open' | 'bot' | 'closed'; difficulty?: Difficulty }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_match' }
  | InputMsg
  | { type: 'emote'; id: EmoteId }
  | { type: 'rematch_vote'; yes: boolean }
  | { type: 'pong'; t: number };

export type C2SType = C2S['type'];

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'bad_message'
  | 'bad_version'
  | 'rate_limited'
  | 'not_ready'
  | 'not_found'
  | 'room_full'
  | 'room_in_match'
  | 'already_in_room'
  | 'not_in_room'
  | 'not_host'
  | 'nickname_invalid'
  | 'nickname_taken'
  | 'nickname_required'
  | 'already_queued'
  | 'locked_item'
  | 'invalid'
  | 'server_error';

export interface SnapshotMsg {
  type: 'snapshot';
  tick: number;
  serverTime: number;
  /** Last input seq from THIS recipient that the server has applied. */
  ack: number;
  players: PlayerSnap[];
  balloons: {
    id: number;
    owner: number;
    tx: number;
    ty: number;
    x: number;
    y: number;
    placedTick: number;
    burstTick: number;
    range: number;
    slideDir: DirCode;
    passMask: number;
    fromDuck: boolean;
  }[];
  splashes: Splash[];
  items: ItemSnap[];
  tideLevel: number;
  nextTideTick: number;
  /** Round-trip ping (ms) per slot for the HUD, -1 for bots/unknown. */
  pings: number[];
}

export interface RoundStartMsg {
  type: 'round_start';
  roundNo: number;
  /** Cosmetic seed only (decorations). The real map seed stays server-side so hidden power-ups cannot be derived. */
  mapSeed: number;
  /** Row-major tile codes as a string of '0' | '1' | '2' (Floor | Boulder | Castle), length w*h. */
  castleGrid: string;
  theme: Theme;
  w: number;
  h: number;
  /** Server time (ms) at which tick 0 happens (end of the 3-2-1 intro). */
  startTime: number;
  spawns: { slot: number; x: number; y: number }[];
  /** Round wins per slot so far. */
  scores: number[];
  tideStartTick: number;
  /**
   * Present when (re)joining mid-round: the current tick. A round re-joined after it was decided
   * (the settle before round_end) is followed at once by its round_over `event` again.
   */
  resumeTick?: number;
}

export interface RoundEndMsg {
  type: 'round_end';
  roundNo: number;
  /** Winning slot or -1 for a draw. */
  winner: number;
  scores: number[];
  summaries: PlayerRoundSummary[];
  matchOver: boolean;
}

export interface MatchEndMsg {
  type: 'match_end';
  matchId: string;
  mode: Mode;
  ranked: boolean;
  practice: boolean;
  tutorial: boolean;
  placements: PlacementEntry[];
  /** Ranked only. */
  ratingDeltas: RatingDelta[] | null;
  /** Human players only. */
  xp: XpAward[];
  funStats: FunStat[];
  canRematch: boolean;
}

export type S2C =
  | { type: 'welcome'; playerId: string; profile: Profile; token: string; serverTime: number }
  | { type: 'profile'; profile: Profile }
  | { type: 'error'; code: ErrorCode; msg: string }
  | { type: 'queue_status'; mode: Mode; elapsedMs: number; searchRange: number; eta: number; inQueue: number }
  | { type: 'queue_left' }
  | { type: 'match_found'; mode: Mode; roomCode: string; players: MatchPlayerInfo[] }
  | { type: 'room_created'; code: string; link: string }
  | { type: 'room_list'; rooms: RoomSummary[] }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'left_room'; reason: 'left' | 'kicked' | 'closed' | 'match_over' }
  | { type: 'match_start'; config: MatchConfig }
  | RoundStartMsg
  | SnapshotMsg
  | { type: 'event'; tick: number; events: GameEvent[] }
  | RoundEndMsg
  | MatchEndMsg
  | { type: 'emote'; slot: number; id: EmoteId }
  | { type: 'ping'; t: number; rtt: number }
  | { type: 'tutorial_step'; step: number; total: number; title: string; text: string; done: boolean }
  | { type: 'player_status'; slot: number; connected: boolean; replacedByBot: boolean; forfeited: boolean };

export type S2CType = S2C['type'];

/** Narrow a union member by its `type` tag. */
export type MsgOf<U extends { type: string }, T extends U['type']> = Extract<U, { type: T }>;
