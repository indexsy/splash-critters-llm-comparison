import type {
  ArenaRoundStart,
  ArenaTheme,
  AnimalId,
  Difficulty,
  Dir,
  GameMode,
  HatId,
  LobbyView,
  MatchConfig,
  MatchEndPayload,
  MatchPlayerInfo,
  PlayerProfile,
  PowerupKind,
  RatingSummary,
  RoomSummary,
  RoundEndPayload,
  RoundSnapshot,
  SimEvent,
  Vec,
} from "./types.js";

export interface CreateRoomOptions {
  name: string;
  size: 2 | 4;
  isPrivate: boolean;
  theme: ArenaTheme | "random";
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  practice?: boolean;
}

export type ClientMessage =
  | { t: "hello"; token?: string; lagMs?: number }
  | { t: "set_nickname"; nickname: string }
  | { t: "queue_join"; mode: GameMode }
  | { t: "queue_leave" }
  | { t: "create_room"; opts: CreateRoomOptions }
  | { t: "join_room"; code: string }
  | { t: "room_list_request" }
  | { t: "leave_room" }
  | { t: "set_slot"; slot: number; kind: "empty" | "bot"; difficulty?: Difficulty }
  | { t: "set_ready"; ready: boolean }
  | { t: "start_match" }
  | { t: "input"; seq: number; tick: number; dir: Dir; balloonPressed: boolean }
  | { t: "emote"; id: number }
  | { t: "rematch_vote" }
  | { t: "pong"; sentAt: number }
  | { t: "set_cosmetics"; animal: AnimalId; hat: HatId }
  | { t: "tutorial_complete" };

export type ServerMessage =
  | {
      t: "welcome";
      playerId: string;
      profile: PlayerProfile;
      token?: string;
      serverTick: number;
    }
  | { t: "error"; code: string; msg: string }
  | { t: "queue_status"; eta: number; searchRange: number; mode: GameMode; elapsedMs: number }
  | {
      t: "match_found";
      mode: GameMode;
      ranked: boolean;
      players: MatchPlayerInfo[];
      roomCode: string;
    }
  | { t: "room_created"; code: string }
  | { t: "room_list"; rooms: RoomSummary[] }
  | { t: "lobby_state"; lobby: LobbyView }
  | { t: "match_start"; config: MatchConfig }
  | { t: "round_start"; data: ArenaRoundStart }
  | {
      t: "snapshot";
      tick: number;
      players: RoundSnapshot["players"];
      balloons: RoundSnapshot["balloons"];
      splashes: RoundSnapshot["splashes"];
      powerups: RoundSnapshot["powerups"];
      tide: RoundSnapshot["tide"];
      ended: boolean;
      winnerId: string | null;
      draw: boolean;
      acks: Record<string, number>;
    }
  | ({ t: "event" } & SimEvent)
  | { t: "emote"; playerId: string; id: number }
  | { t: "notice"; msg: string }
  | { t: "round_end"; data: RoundEndPayload }
  | { t: "match_end"; data: MatchEndPayload }
  | { t: "rematch_status"; votes: number; needed: number }
  | { t: "profile_update"; profile: PlayerProfile }
  | { t: "ping"; sentAt: number; rtt: number };

export type { SimEvent as GameEvent };

export interface LeaderboardResponse {
  mode: GameMode;
  entries: Array<{
    rank: number;
    playerId: string;
    displayName: string;
    rating: number;
    tier: string;
    games: number;
    winrate: number;
  }>;
}

export interface ProfileResponse {
  profile: PlayerProfile;
  ratings: Partial<Record<GameMode, RatingSummary>>;
  recentMatches: Array<{
    matchId: number;
    mode: GameMode;
    ranked: boolean;
    endedAt: number;
    placement: number;
    soaks: number;
    roundsWon: number;
    ratingBefore: number | null;
    ratingAfter: number | null;
  }>;
  unlocks: string[];
}

export type PowerupList = Array<{ kind: PowerupKind; x: number; y: number }>;

export interface LobbyBroadcast {
  lobby: LobbyView;
}

export interface ArenaGeometry {
  w: number;
  h: number;
  spawns: Vec[];
}
