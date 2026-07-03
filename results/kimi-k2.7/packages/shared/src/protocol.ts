import type { Animal, Difficulty, Hat, Mode, Theme } from "./config.js";
import type { GameEvent, InputState, LobbySlot, Profile, RoomInfo, RoomOpts, Snapshot } from "./types.js";

// Client -> Server
export type ClientMsg =
  | { type: "hello"; token?: string }
  | { type: "set_nickname"; nickname: string }
  | { type: "queue_join"; mode: Mode }
  | { type: "queue_leave" }
  | { type: "create_room"; opts: RoomOpts }
  | { type: "join_room"; code: string }
  | { type: "room_list_request"; mode?: Mode }
  | { type: "leave_room" }
  | { type: "set_slot"; slot: number; kind: "human" | "bot" | "closed"; difficulty?: Difficulty }
  | { type: "set_ready"; ready: boolean }
  | { type: "start_match" }
  | { type: "input"; input: InputState }
  | { type: "emote"; id: number }
  | { type: "rematch_vote"; vote: boolean }
  | { type: "pong"; t: number }
  | { type: "tutorial_complete" };

// Server -> Client
export type ServerMsg =
  | { type: "welcome"; playerId: string; profile: Profile; token: string }
  | { type: "error"; code: string; msg: string }
  | { type: "queue_status"; elapsedMs: number; searchRange: number }
  | { type: "match_found"; matchId: string; mode: Mode }
  | { type: "room_created"; code: string }
  | { type: "room_list"; rooms: RoomInfo[] }
  | { type: "lobby_state"; code: string; name: string; host: string; mode: Mode; slots: LobbySlot[]; started: boolean }
  | { type: "match_start"; matchId: string; mode: Mode; theme: Theme; players: { id: string; nickname: string; animal: Animal; hat: Hat }[] }
  | { type: "round_start"; roundNo: number; mapSeed: number; castleGrid: boolean[][]; theme: Theme }
  | { type: "snapshot"; snap: Snapshot }
  | { type: "event"; event: GameEvent }
  | { type: "round_end"; roundNo: number; winnerId: string | null; draw: boolean; roundWins: Record<string, number> }
  | { type: "match_end"; placements: { playerId: string; placement: number }[]; ratingDeltas: Record<string, number>; xp: Record<string, number>; stats: Record<string, { soaks: number; castles: number; roundsWon: number }> }
  | { type: "ping"; t: number }
  | { type: "profile_update"; profile: Profile };

export function encodeMsg(msg: ServerMsg | ClientMsg): string {
  return JSON.stringify(msg);
}

export function decodeMsg(data: string): ClientMsg | ServerMsg {
  return JSON.parse(data);
}
