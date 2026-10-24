import type {
  Animal,
  BotDifficulty,
  Direction,
  FunStats,
  GameEvent,
  GameMode,
  Hat,
  LobbySlot,
  MatchConfig,
  MatchPlacement,
  PlayerDescriptor,
  PlayerProfile,
  RoomListItem,
  Snapshot,
  Theme,
  ThemeChoice,
  TileValue
} from "./types.js";

export interface RoomOptions {
  name: string;
  maxPlayers: 2 | 4;
  public: boolean;
  theme: ThemeChoice;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export type ClientMessage =
  | { type: "hello"; token?: string }
  | { type: "set_nickname"; nickname: string }
  | { type: "set_cosmetics"; animal: Animal; hat: Hat }
  | { type: "queue_join"; mode: GameMode }
  | { type: "queue_leave" }
  | { type: "create_room"; opts: RoomOptions }
  | { type: "join_room"; code: string }
  | { type: "room_list_request"; filter?: GameMode | "all" }
  | { type: "leave_room" }
  | { type: "set_slot"; slot: number; kind: "open" | "bot"; difficulty?: BotDifficulty }
  | { type: "set_ready"; ready?: boolean }
  | { type: "start_match" }
  | { type: "practice_start"; difficulty: BotDifficulty }
  | { type: "tutorial_start" }
  | { type: "input"; seq: number; tick: number; dir: Direction; balloonPressed: boolean }
  | { type: "emote"; id: number }
  | { type: "rematch_vote"; vote?: boolean }
  | { type: "pong"; t: number };

export type ServerMessage =
  | { type: "welcome"; playerId: string; sessionId: string; profile: PlayerProfile; token: string }
  | { type: "profile_update"; profile: PlayerProfile }
  | { type: "error"; code: string; msg: string }
  | { type: "queue_status"; mode: GameMode; eta: number; searchRange: number; players: number }
  | { type: "match_found"; mode: GameMode; code: string }
  | { type: "room_created"; code: string; url: string }
  | { type: "room_list"; rooms: RoomListItem[] }
  | {
      type: "lobby_state";
      code: string;
      you: string;
      name: string;
      mode: GameMode;
      maxPlayers: number;
      theme: Theme;
      hostId: string;
      public: boolean;
      roundsToWin: number;
      botFill: boolean;
      inMatch: boolean;
      slots: LobbySlot[];
      rematchVotes: number;
      rematchNeeded: number;
    }
  | { type: "match_start"; config: MatchConfig; players: PlayerDescriptor[]; localPlayerId: string; ratings: Record<string, number | null> }
  | {
      type: "round_start";
      roundNo: number;
      mapSeed: number;
      castleGrid: TileValue[];
      width: number;
      height: number;
      theme: Theme;
      serverTick: number;
    }
  | { type: "snapshot"; data: Snapshot; serverTime: number }
  | { type: "event"; event: GameEvent }
  | { type: "round_end"; roundNo: number; winnerId: string | null; scores: Record<string, number> }
  | {
      type: "match_end";
      placements: MatchPlacement[];
      ratingDeltas: Record<string, number>;
      xp: Record<string, number>;
      funStats: FunStats;
    }
  | { type: "ping"; t: number };
