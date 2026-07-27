/**
 * The wire protocol: two discriminated unions over `t`, plus the payload shapes
 * they carry. Everything crossing the socket is JSON and is defined here - if
 * it is not in this file, it does not go over the wire.
 */

import type {
  AnimalId,
  BotDifficulty,
  DirValue,
  GameMode,
  HatId,
  LeaderboardRow,
  MapTheme,
  MatchHistoryRow,
  PlayerProfile,
  PowerupType,
  RankTierId,
  RoundPhase,
  SimEvent,
} from './types.js';

// ------------------------------------------------------------------- payloads

export interface RoomSummary {
  code: string;
  name: string;
  mode: GameMode;
  players: number;
  maxPlayers: number;
  theme: MapTheme | 'random';
  hostName: string;
  roundsToWin: number;
  inProgress: boolean;
}

export type SlotKind = 'open' | 'human' | 'bot' | 'closed';

export interface SlotInfo {
  slot: number;
  kind: SlotKind;
  /** Null for bots and open slots. */
  playerId: string | null;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  level: number;
  ready: boolean;
  connected: boolean;
  difficulty: BotDifficulty | null;
  rating: number | null;
  tier: RankTierId | null;
}

export interface LobbyState {
  code: string;
  name: string;
  mode: GameMode;
  theme: MapTheme | 'random';
  roundsToWin: number;
  isPublic: boolean;
  botFill: boolean;
  ranked: boolean;
  /** Slot number of the host, or -1 for matchmaker-owned ranked rooms. */
  hostSlot: number;
  slots: SlotInfo[];
  phase: 'lobby' | 'match' | 'results';
}

export interface CreateRoomOpts {
  name: string;
  /** 2 => duel, 4 => free-for-all. */
  size: 2 | 4;
  isPublic: boolean;
  theme: MapTheme | 'random';
  roundsToWin: number;
  botFill: boolean;
  /** Skip the lobby and start as soon as the room exists (practice/tutorial). */
  autoStart?: boolean;
  /** Marks the room as the guided first-run experience. */
  tutorial?: boolean;
}

export interface MatchPlayerInfo {
  slot: number;
  /** Null for bots. */
  playerId: string | null;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  level: number;
  isBot: boolean;
  difficulty: BotDifficulty | null;
  rating: number | null;
  tier: RankTierId | null;
}

export interface MatchConfig {
  matchId: string;
  mode: GameMode;
  ranked: boolean;
  tutorial: boolean;
  roundsToWin: number;
  theme: MapTheme;
  width: number;
  height: number;
  /** Which slot the receiving client controls. -1 when spectating. */
  yourSlot: number;
  revengeDucks: boolean;
  kickEnabled: boolean;
  players: MatchPlayerInfo[];
}

export interface PlayerSnap {
  id: number;
  x: number;
  y: number;
  facing: DirValue;
  alive: boolean;
  moving: boolean;
  speed: number;
  balloons: number;
  range: number;
  kick: boolean;
  active: number;
  emote: number;
  emoteTicks: number;
  ghost: boolean;
  ghostPos: number;
  soaks: number;
  castles: number;
}

export interface BalloonSnap {
  id: number;
  owner: number;
  x: number;
  y: number;
  burstTick: number;
  range: number;
  slide: DirValue;
}

export interface SplashSnap {
  id: number;
  owner: number;
  x: number;
  y: number;
  arms: number[];
  capped: boolean[];
  endTick: number;
}

export interface PowerupSnap {
  id: number;
  type: PowerupType;
  x: number;
  y: number;
}

export interface LobSnap {
  id: number;
  owner: number;
  x: number;
  y: number;
  dir: DirValue;
}

export interface MatchPlacement {
  slot: number;
  playerId: string | null;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  placement: number;
  roundsWon: number;
  soaks: number;
  castles: number;
  bestChain: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  tier: RankTierId | null;
  xpEarned: number;
  levelBefore: number;
  levelAfter: number;
  unlocked: string[];
}

export interface AwardEntry {
  slot: number;
  nickname: string;
  value: number;
}

export interface MatchAwards {
  mostSoaks: AwardEntry | null;
  castleCrusher: AwardEntry | null;
  longestSurvivor: AwardEntry | null;
  biggestChain: AwardEntry | null;
}

export type ErrorCode =
  | 'bad_message'
  | 'rate_limited'
  | 'not_authenticated'
  | 'nickname_invalid'
  | 'nickname_taken'
  | 'nickname_required'
  | 'room_not_found'
  | 'room_full'
  | 'room_in_progress'
  | 'not_host'
  | 'not_in_room'
  | 'already_queued'
  | 'not_queued'
  | 'invalid_slot'
  | 'invalid_option'
  | 'server_error';

// ------------------------------------------------------------- client → server

export interface HelloMsg {
  t: 'hello';
  token?: string;
  /** Client build stamp, echoed back in logs to spot stale tabs. */
  version?: string;
}
export interface SetNicknameMsg {
  t: 'set_nickname';
  nickname: string;
}
export interface SetCosmeticsMsg {
  t: 'set_cosmetics';
  animal: AnimalId;
  hat: HatId;
}
export interface SetTutorialDoneMsg {
  t: 'set_tutorial_done';
}
export interface QueueJoinMsg {
  t: 'queue_join';
  mode: GameMode;
}
export interface QueueLeaveMsg {
  t: 'queue_leave';
}
export interface CreateRoomMsg {
  t: 'create_room';
  opts: CreateRoomOpts;
}
export interface JoinRoomMsg {
  t: 'join_room';
  code: string;
}
export interface RoomListRequestMsg {
  t: 'room_list_request';
  mode?: GameMode;
}
export interface LeaveRoomMsg {
  t: 'leave_room';
}
export interface SetSlotMsg {
  t: 'set_slot';
  slot: number;
  kind: 'open' | 'bot';
  difficulty?: BotDifficulty;
}
export interface SetReadyMsg {
  t: 'set_ready';
  ready: boolean;
}
export interface StartMatchMsg {
  t: 'start_match';
}
export interface InputMsg {
  t: 'input';
  seq: number;
  tick: number;
  dir: DirValue;
  balloonPressed: boolean;
}
export interface EmoteMsg {
  t: 'emote';
  id: number;
}
export interface RematchVoteMsg {
  t: 'rematch_vote';
  vote: boolean;
}
export interface PongMsg {
  t: 'pong';
  /** Echo of the server timestamp from `ping`. */
  time: number;
}

export type ClientMessage =
  | HelloMsg
  | SetNicknameMsg
  | SetCosmeticsMsg
  | SetTutorialDoneMsg
  | QueueJoinMsg
  | QueueLeaveMsg
  | CreateRoomMsg
  | JoinRoomMsg
  | RoomListRequestMsg
  | LeaveRoomMsg
  | SetSlotMsg
  | SetReadyMsg
  | StartMatchMsg
  | InputMsg
  | EmoteMsg
  | RematchVoteMsg
  | PongMsg;

// ------------------------------------------------------------- server → client

export interface WelcomeMsg {
  t: 'welcome';
  playerId: string;
  token: string;
  profile: PlayerProfile;
  /** Room code to rejoin after a refresh, when one is still live. */
  activeRoom: string | null;
  serverTime: number;
}
export interface ErrorMsg {
  t: 'error';
  code: ErrorCode;
  msg: string;
}
export interface ProfileUpdateMsg {
  t: 'profile_update';
  profile: PlayerProfile;
}
export interface QueueStatusMsg {
  t: 'queue_status';
  mode: GameMode;
  elapsedMs: number;
  /** Rough seconds-to-match estimate, or null while unknown. */
  eta: number | null;
  searchRange: number;
  waiting: number;
}
export interface MatchFoundMsg {
  t: 'match_found';
  code: string;
  mode: GameMode;
}
export interface RoomCreatedMsg {
  t: 'room_created';
  code: string;
}
export interface RoomListMsg {
  t: 'room_list';
  rooms: RoomSummary[];
}
export interface LobbyStateMsg {
  t: 'lobby_state';
  lobby: LobbyState;
}
export interface MatchStartMsg {
  t: 'match_start';
  config: MatchConfig;
}
export interface RoundStartMsg {
  t: 'round_start';
  roundNo: number;
  /**
   * Row-major TileValue grid. Hidden power-up contents are never included, and
   * neither is the generation seed: the seed rolls those contents in a second
   * deterministic pass, so shipping it would hand a modified client every
   * power-up on the map before a single castle had been washed away.
   */
  castleGrid: number[];
  theme: MapTheme;
  startTick: number;
  countdownTicks: number;
  scores: number[];
}
export interface SnapshotMsg {
  t: 'snapshot';
  tick: number;
  /** Last input sequence number this server has consumed from you. */
  ack: number;
  phase: RoundPhase;
  phaseEndTick: number;
  players: PlayerSnap[];
  balloons: BalloonSnap[];
  splashes: SplashSnap[];
  powerups: PowerupSnap[];
  lobs: LobSnap[];
  tideCursor: number;
  scores: number[];
  /** Round-trip time per slot, for the HUD. Bots read 0. */
  pings?: number[];
}
export interface EventMsg {
  t: 'event';
  tick: number;
  event: SimEvent;
}
export interface RoundEndMsg {
  t: 'round_end';
  roundNo: number;
  winners: number[];
  scores: number[];
  matchOver: boolean;
}
export interface MatchEndMsg {
  t: 'match_end';
  matchId: string;
  ranked: boolean;
  placements: MatchPlacement[];
  awards: MatchAwards;
  /** False for ranked and tutorial rooms. */
  rematchEnabled: boolean;
}
export interface RematchStateMsg {
  t: 'rematch_state';
  votes: number;
  needed: number;
  youVoted: boolean;
}
export interface NoticeMsg {
  t: 'notice';
  kind: 'disconnect' | 'reconnect' | 'bot_substitute' | 'forfeit' | 'info';
  msg: string;
}
export interface PingMsg {
  t: 'ping';
  time: number;
  /** Round-trip time measured on the previous exchange, in ms. */
  rtt?: number;
}

export type ServerMessage =
  | WelcomeMsg
  | ErrorMsg
  | ProfileUpdateMsg
  | QueueStatusMsg
  | MatchFoundMsg
  | RoomCreatedMsg
  | RoomListMsg
  | LobbyStateMsg
  | MatchStartMsg
  | RoundStartMsg
  | SnapshotMsg
  | EventMsg
  | RoundEndMsg
  | MatchEndMsg
  | RematchStateMsg
  | NoticeMsg
  | PingMsg;

// ------------------------------------------------------------------ REST shapes

export interface LeaderboardResponse {
  mode: GameMode;
  rows: LeaderboardRow[];
}

export interface ProfileResponse {
  profile: PlayerProfile;
  recentMatches: MatchHistoryRow[];
}
