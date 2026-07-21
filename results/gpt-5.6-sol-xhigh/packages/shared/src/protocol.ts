import type { Difficulty, Direction, GameState, LobbyView, Mode, Profile, RoomOptions, RoomSummary, SimEvent, Theme } from "./types.js";

export type ClientMessage =
  | { type: "hello"; token?: string }
  | { type: "set_nickname"; nickname: string }
  | { type: "set_cosmetic"; animal: string; hat: string }
  | { type: "tutorial_complete" }
  | { type: "queue_join"; mode: Mode }
  | { type: "queue_leave" }
  | { type: "create_room"; opts: RoomOptions }
  | { type: "join_room"; code: string }
  | { type: "room_list_request"; mode?: Mode }
  | { type: "leave_room" }
  | { type: "set_slot"; slot: number; kind: "empty" | "bot"; difficulty?: Difficulty }
  | { type: "set_ready"; ready: boolean }
  | { type: "start_match" }
  | { type: "input"; seq: number; tick: number; dir: Direction; balloonPressed: boolean; revengePressed?: boolean }
  | { type: "emote"; id: 1 | 2 | 3 | 4 }
  | { type: "rematch_vote" }
  | { type: "pong"; t: number };

export type ServerMessage =
  | { type: "welcome"; playerId: string; profile: Profile; token: string }
  | { type: "profile_updated"; profile: Profile }
  | { type: "error"; code: string; msg: string }
  | { type: "queue_status"; eta: number; searchRange: number; elapsed: number }
  | { type: "match_found"; roomCode: string }
  | { type: "room_created"; code: string }
  | { type: "room_list"; rooms: RoomSummary[] }
  | { type: "lobby_state"; lobby: LobbyView }
  | { type: "match_start"; config: { mode: Mode; ranked: boolean; roundsToWin: number; theme: Theme } }
  | { type: "round_start"; roundNo: number; mapSeed: number; castleGrid: number[][]; theme: Theme }
  | { type: "snapshot"; state: GameState; serverTime: number; ackSeq: number }
  | { type: "event"; event: SimEvent }
  | { type: "emote"; playerId: string; id: number }
  | { type: "round_end"; winnerIds: string[]; scores: Record<string, number> }
  | { type: "match_end"; placements: Array<{ playerId: string; name: string; placement: number; soaks: number; castles: number }>; ratingDeltas: Record<string, number>; xp: Record<string, number> }
  | { type: "ping"; t: number };

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "hello": return message.token === undefined || (typeof message.token === "string" && message.token.length <= 256);
    case "set_nickname": return typeof message.nickname === "string";
    case "set_cosmetic": return typeof message.animal === "string" && typeof message.hat === "string";
    case "tutorial_complete":
    case "queue_leave":
    case "leave_room":
    case "start_match":
    case "rematch_vote": return true;
    case "queue_join": return message.mode === "duel" || message.mode === "ffa";
    case "create_room": return !!message.opts && typeof message.opts === "object";
    case "join_room": return typeof message.code === "string" && message.code.length <= 12;
    case "room_list_request": return message.mode === undefined || message.mode === "duel" || message.mode === "ffa";
    case "set_slot": return Number.isInteger(message.slot) && (message.kind === "empty" || message.kind === "bot") &&
      (message.difficulty === undefined || message.difficulty === "easy" || message.difficulty === "medium" || message.difficulty === "hard");
    case "set_ready": return typeof message.ready === "boolean";
    case "input": return Number.isInteger(message.seq) && Number.isInteger(message.tick) &&
      ["up", "down", "left", "right", "none"].includes(String(message.dir)) && typeof message.balloonPressed === "boolean" &&
      (message.revengePressed === undefined || typeof message.revengePressed === "boolean");
    case "emote": return Number.isInteger(message.id) && Number(message.id) >= 1 && Number(message.id) <= 4;
    case "pong": return typeof message.t === "number" && Number.isFinite(message.t);
    default: return false;
  }
}
