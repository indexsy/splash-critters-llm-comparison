import type { AnimalId, HatId, MapTheme } from "./config.js";
import type {
  BalloonState,
  BotDifficulty,
  Dir,
  ExposedPowerup,
  LeaderboardEntry,
  Mode,
  PlayerInput,
  PlayerState,
  Profile,
  RoomInfo,
  SimEvent,
  SlotKind,
  SlotState,
  SplashState,
  TileKind,
} from "./types.js";

export type ClientMsg =
  | { type: "hello"; token?: string }
  | { type: "set_nickname"; nickname: string }
  | { type: "set_cosmetic"; animal: AnimalId; hat: HatId }
  | { type: "queue_join"; mode: Mode }
  | { type: "queue_leave" }
  | { type: "create_room"; opts: CreateRoomOpts }
  | { type: "join_room"; code: string }
  | { type: "room_list_request" }
  | { type: "leave_room" }
  | { type: "set_slot"; slot: number; kind: SlotKind; difficulty?: BotDifficulty }
  | { type: "set_ready"; ready: boolean }
  | { type: "start_match" }
  | { type: "input"; seq: number; tick: number; dir: Dir; balloonPressed: boolean }
  | { type: "emote"; id: number }
  | { type: "rematch_vote" }
  | { type: "pong"; t: number }
  | { type: "tutorial_complete" };

export interface CreateRoomOpts {
  name: string;
  size: 2 | 4;
  public: boolean;
  theme: MapTheme;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export interface SnapshotPayload {
  tick: number;
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  exposed: ExposedPowerup[];
  tideRing: number;
  hitstop: number;
}

export interface Placement {
  playerId: string;
  nickname: string;
  tag: number;
  place: number;
  soaks: number;
  roundsWon: number;
  ratingBefore?: number;
  ratingAfter?: number;
  xpEarned: number;
}

export interface FunStats {
  mostSoaks?: { name: string; value: number };
  castleCrusher?: { name: string; value: number };
  longestSurvivor?: { name: string; value: number };
  biggestChain?: { name: string; value: number };
}

export type ServerMsg =
  | { type: "welcome"; playerId: string; profile: Profile; token: string }
  | { type: "error"; code: string; msg: string }
  | { type: "queue_status"; eta: number; searchRange: number; elapsed: number; mode: Mode }
  | { type: "match_found"; roomCode: string; mode: Mode; ranked: boolean }
  | { type: "room_created"; code: string }
  | { type: "room_list"; rooms: RoomInfo[] }
  | { type: "lobby_state"; code: string; name: string; hostId: string; slots: SlotState[]; theme: MapTheme; roundsToWin: number; public: boolean; mode: Mode; votes: string[] }
  | {
      type: "match_start";
      config: {
        mode: Mode;
        ranked: boolean;
        roundsToWin: number;
        theme: MapTheme;
        width: number;
        height: number;
        enableKick: boolean;
        enableRevengeDucks: boolean;
      };
      players: { id: string; nickname: string; tag: number; animal: AnimalId; hat: HatId; rating?: number; tier?: string; slot: number }[];
    }
  | {
      type: "round_start";
      roundNo: number;
      mapSeed: number;
      castleGrid: TileKind[];
      theme: string;
      width: number;
      height: number;
    }
  | { type: "snapshot"; snap: SnapshotPayload }
  | { type: "event"; event: SimEvent }
  | {
      type: "round_end";
      winnerIds: string[];
      draw: boolean;
      scores: Record<string, number>;
    }
  | {
      type: "match_end";
      placements: Placement[];
      ratingDeltas: Record<string, number>;
      xp: Record<string, number>;
      fun: FunStats;
      ranked: boolean;
    }
  | { type: "ping"; t: number }
  | { type: "emote_fx"; playerId: string; emoteId: number }
  | { type: "countdown"; value: number | "SPLASH" }
  | { type: "profile"; profile: Profile }
  | { type: "leaderboard"; mode: Mode; entries: LeaderboardEntry[] };

export type { PlayerInput };
