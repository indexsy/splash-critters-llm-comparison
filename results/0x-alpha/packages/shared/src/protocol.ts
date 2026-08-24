import type { BotDifficulty, GameMode, MatchConfig, PowerupType, SlotKind, SnapshotPayload } from "./types";
import type { MapTheme } from "./config";

// ---------- Client → Server ----------

export interface HelloMsg {
  t: "hello";
  token?: string;
}
export interface SetNicknameMsg {
  t: "set_nickname";
  nickname: string;
}
export interface SelectMsg {
  t: "select";
  animal: string;
  hat: string | null;
}
export interface QueueJoinMsg {
  t: "queue_join";
  mode: GameMode;
}
export interface QueueLeaveMsg {
  t: "queue_leave";
}
export interface CreateRoomMsg {
  t: "create_room";
  name: string;
  mode: GameMode;
  isPublic: boolean;
  theme: MapTheme | "random";
  roundsToWin: number;
  botFill: boolean;
}
export interface JoinRoomMsg {
  t: "join_room";
  code: string;
}
export interface RoomListRequestMsg {
  t: "room_list_request";
}
export interface LeaveRoomMsg {
  t: "leave_room";
}
export interface SetSlotMsg {
  t: "set_slot";
  slot: number;
  kind: SlotKind;
  difficulty?: BotDifficulty;
}
export interface SetReadyMsg {
  t: "set_ready";
  ready: boolean;
}
export interface StartMatchMsg {
  t: "start_match";
}
export interface InputMsg {
  t: "input";
  seq: number;
  tick: number;
  dirX: number;
  dirY: number;
  balloonPressed: boolean;
}
export interface EmoteMsg {
  t: "emote";
  id: number;
}
export interface RematchVoteMsg {
  t: "rematch_vote";
}
export interface PongMsg {
  t: "pong";
  t1: number;
}

export type ClientMsg =
  | HelloMsg
  | SetNicknameMsg
  | SelectMsg
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

// ---------- Server → Client ----------

export interface PublicProfile {
  id: string;
  nickname: string;
  tag: string;
  level: number;
  xp: number;
  xpForNext: number;
  selectedAnimal: string;
  selectedHat: string | null;
  unlocks: { animals: string[]; hats: string[] };
}

export interface WelcomeMsg {
  t: "welcome";
  playerId: string;
  token: string;
  profile: PublicProfile;
  ratings: Record<GameMode, { rating: number; games: number; wins: number; peak: number }>;
}

export interface ErrorMsg {
  t: "error";
  code: string;
  msg: string;
}

export interface QueueStatusMsg {
  t: "queue_status";
  mode: GameMode;
  elapsedMs: number;
  etaSec: number | null;
  searchRange: number;
  waiting: number;
}

export interface MatchFoundMsg {
  t: "match_found";
  mode: GameMode;
  ranked: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: GameMode;
  players: number;
  maxPlayers: number;
  theme: MapTheme | "random";
  hostNickname: string;
}

export interface RoomListMsg {
  t: "room_list";
  rooms: RoomSummary[];
}

export interface LobbySlot {
  index: number;
  kind: SlotKind;
  playerId?: string;
  nickname?: string;
  animal?: string;
  difficulty?: BotDifficulty;
  ready?: boolean;
}

export interface LobbyStateMsg {
  t: "lobby_state";
  code: string;
  name: string;
  mode: GameMode;
  isPublic: boolean;
  theme: MapTheme | "random";
  roundsToWin: number;
  slots: LobbySlot[];
  hostSlot: number;
}

export interface MatchStartMsg {
  t: "match_start";
  config: MatchConfig;
  ranked: boolean;
  entities: Array<{ id: string; playerId?: string; nickname: string; animal: string; hat: string | null; isBot: boolean; rating?: number; tier?: string }>;
  yourEntityId: string;
}

export interface RoundStartMsg {
  t: "round_start";
  roundNo: number;
  mapSeed: number;
  castleGrid: number[]; // packed grid (0 floor, 1 boulder, 2 castle)
  w: number;
  h: number;
  theme: MapTheme;
  spawns: Array<{ entityId: string; x: number; y: number }>;
  scores: Record<string, number>; // rounds won per entity
}

export interface SnapshotMsg {
  t: "snapshot";
  snapshot: SnapshotPayload;
}

export interface SimEventMsg {
  t: "event";
  event: {
    type:
      | "castle_washed"
      | "powerup_revealed"
      | "powerup_collected"
      | "player_soaked"
      | "chain_burst"
      | "balloon_kicked"
      | "tide_advance"
      | "revenge_lob"
      | "round_timeout_draw";
    tick: number;
    by?: string;
    target?: string;
    tile?: number;
    powerup?: PowerupType;
    chain?: number;
    revenge?: boolean;
  };
}

export interface RoundEndMsg {
  t: "round_end";
  roundNo: number;
  winners: string[];
  soakedThisRound: Array<{ entityId: string; byEntityId: string | null; revenge: boolean }>;
  scores: Record<string, number>;
}

export interface Placement {
  entityId: string;
  playerId?: string;
  nickname: string;
  placement: number;
  roundsWon: number;
  soaks: number;
  castlesWashed: number;
}

export interface RatingDeltaInfo {
  before: number;
  after: number;
  tier: string;
}

export interface MatchEndMsg {
  t: "match_end";
  placements: Placement[];
  funStats: { mostSoaks?: string; castleCrusher?: string; longestSurvivor?: string; biggestChain?: string };
  xp: Record<string, number>; // playerId → xp
  levelUps: Record<string, { from: number; to: number }>;
  ratingDeltas: Record<string, RatingDeltaInfo>; // playerId → delta info
  unlocks: Record<string, { animals: string[]; hats: string[] }>;
}

export interface PingMsg {
  t: "ping";
  time: number;
}

export interface EmoteEventMsg {
  t: "emote_event";
  entityId: string;
  id: number;
}

export interface RematchStateMsg {
  t: "rematch_state";
  votes: string[];
  needed: number;
}

export type ServerMsg =
  | WelcomeMsg
  | ErrorMsg
  | QueueStatusMsg
  | MatchFoundMsg
  | RoomListMsg
  | LobbyStateMsg
  | MatchStartMsg
  | RoundStartMsg
  | SnapshotMsg
  | SimEventMsg
  | RoundEndMsg
  | MatchEndMsg
  | PingMsg
  | EmoteEventMsg
  | RematchStateMsg;
