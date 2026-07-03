// protocol.ts — wire protocol as discriminated unions (spec §8).

import type { Animal, GameMode, Hat } from "./config.js";
import type { Dir, Snapshot } from "./types.js";

export type Difficulty = "easy" | "medium" | "hard";
export type SlotKind = "open" | "bot" | "human";
export type RoomVisibility = "public" | "private";
export type Theme = "backyard" | "beach" | "pool";

export interface Profile {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: Animal;
  selectedHat: Hat;
}

export interface RatingView {
  mode: GameMode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

// ---------- C → S ----------

export type ClientMsg =
  | { t: "hello"; token?: string }
  | { t: "set_nickname"; nickname: string }
  | { t: "queue_join"; mode: GameMode }
  | { t: "queue_leave" }
  | {
      t: "create_room";
      name: string;
      size: 2 | 4;
      visibility: RoomVisibility;
      theme: Theme;
      roundsToWin: number;
      botFill: boolean;
    }
  | { t: "join_room"; code: string }
  | { t: "room_list_request" }
  | { t: "leave_room" }
  | { t: "set_slot"; slot: number; kind: SlotKind; difficulty?: Difficulty }
  | { t: "set_ready"; ready: boolean }
  | { t: "start_match" }
  | { t: "input"; seq: number; tick: number; dir: Dir | -1; balloonPressed: boolean }
  | { t: "emote"; id: number }
  | { t: "rematch_vote"; vote: boolean }
  | { t: "pong"; ts: number };

// ---------- S → C ----------

export interface SlotView {
  slot: number;
  kind: SlotKind;
  difficulty?: Difficulty;
  playerId?: string;
  nickname?: string;
  animal?: Animal;
  ready?: boolean;
  isLocal?: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  size: 2 | 4;
  visibility: RoomVisibility;
  theme: Theme;
  players: number;
  max: number;
  host: string;
}

export type ServerMsg =
  | { t: "welcome"; playerId: string; profile: Profile; token: string }
  | { t: "error"; code: string; msg: string }
  | { t: "queue_status"; eta: number; searchRange: number }
  | { t: "match_found"; mode: GameMode; ranked: boolean }
  | { t: "room_created"; code: string }
  | { t: "room_list"; rooms: RoomSummary[] }
  | { t: "lobby_state"; code: string; name: string; size: 2 | 4; theme: Theme; roundsToWin: number; slots: SlotView[]; hostSlot: number; yourSlot: number }
  | { t: "match_start"; mode: GameMode; roundsToWin: number; theme: Theme; yourSlot: number; players: { slot: number; nickname: string; animal: Animal; rating?: number }[] }
  | { t: "round_start"; roundNo: number; mapSeed: number; width: number; height: number; castleGrid: Uint8Array; theme: Theme; spawns: { x: number; y: number }[] }
  | { t: "snapshot"; snap: Snapshot }
  | { t: "round_end"; roundNo: number; winnerSlot: number; scores: number[] }
  | { t: "match_end"; placements: { slot: number; nickname: string; ratingBefore: number; ratingAfter: number; xp: number; soaks: number; roundsWon: number }[] }
  | { t: "ping"; ts: number };
