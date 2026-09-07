import type {
  Animal,
  Difficulty,
  GameEvent,
  Hat,
  LobbyState,
  MatchConfig,
  MatchResult,
  Mode,
  PlayerInput,
  Profile,
  RoomOptions,
  RoomSummary,
  Snapshot,
  Theme,
  Tile,
} from "./types.js";

export type ClientMessage =
  | { type: "hello"; token?: string }
  | { type: "set_nickname"; nickname: string }
  | { type: "queue_join"; mode: Mode }
  | { type: "queue_leave" }
  | { type: "create_room"; opts: RoomOptions }
  | { type: "join_room"; code: string }
  | { type: "room_list_request"; mode?: Mode }
  | { type: "leave_room" }
  | {
      type: "set_slot";
      slot: number;
      kind: "open" | "bot";
      difficulty?: Difficulty;
    }
  | { type: "set_ready"; ready: boolean }
  | { type: "start_match" }
  | ({ type: "input" } & PlayerInput)
  | { type: "emote"; id: number }
  | { type: "rematch_vote" }
  | { type: "pong"; t: number }
  | { type: "equip"; animal: Animal; hat: Hat }
  | { type: "tutorial_complete" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; profile: Profile; token: string }
  | { type: "profile_updated"; profile: Profile }
  | { type: "error"; code: string; msg: string }
  | {
      type: "queue_status";
      mode: Mode;
      eta: number | null;
      searchRange: number;
      elapsed: number;
      queued: number;
    }
  | { type: "queue_left" }
  | { type: "match_found"; code: string; mode: Mode }
  | { type: "room_created"; code: string }
  | { type: "room_list"; rooms: RoomSummary[] }
  | { type: "lobby_state"; lobby: LobbyState }
  | { type: "room_left" }
  | { type: "match_start"; config: MatchConfig }
  | {
      type: "round_start";
      roundNo: number;
      mapSeed: number;
      castleGrid: Tile[];
      width: number;
      height: number;
      theme: Theme;
    }
  | { type: "snapshot"; state: Snapshot }
  | { type: "event"; event: GameEvent }
  | {
      type: "round_end";
      winnerId: string | null;
      scores: Record<string, number>;
      roundNo: number;
    }
  | ({ type: "match_end" } & MatchResult)
  | { type: "ping"; t: number; rtt?: number };
