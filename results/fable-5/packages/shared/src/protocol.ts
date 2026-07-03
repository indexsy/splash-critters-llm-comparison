import type { BotDifficulty, GameMode, MapTheme, PowerupType } from "./config.js";
import type { Dir, SimEvent } from "./types.js";

// ---------- Shared shapes ----------

export interface ProfileData {
  playerId: string;
  nickname: string;
  tag: string; // "#4821"
  xp: number;
  level: number;
  selectedAnimal: string;
  selectedHat: string;
  unlocks: string[]; // item ids (animals + hats)
  ratings: Record<GameMode, { rating: number; games: number; wins: number; peak: number }>;
  hasCustomNickname: boolean;
  tutorialDone: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: GameMode;
  players: number;
  maxPlayers: number;
  theme: MapTheme | "random";
  host: string; // nickname#tag
}

export type SlotKind = "open" | "human" | "bot" | "closed";

export interface SlotInfo {
  kind: SlotKind;
  playerId?: string;
  nickname?: string; // includes #tag
  animal?: string;
  hat?: string;
  difficulty?: BotDifficulty;
  ready?: boolean;
  connected?: boolean;
}

export interface CreateRoomOpts {
  name: string;
  mode: GameMode;
  isPublic: boolean;
  theme: MapTheme | "random";
  roundsToWin: number;
  botFill: boolean;
}

export interface MatchPlayerInfo {
  slot: number;
  playerId: string;
  nickname: string; // includes #tag
  animal: string;
  hat: string;
  isBot: boolean;
  difficulty?: BotDifficulty;
  rating?: number; // ranked only
  tier?: string;
}

export interface SnapshotPlayer {
  slot: number;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  alive: boolean;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasKick: boolean;
  soaks: number;
  duckPos: number | null;
}

export interface SnapshotBalloon {
  id: number;
  x: number;
  y: number;
  burstTick: number;
  placedTick: number;
  slideDir: Dir; // 0 when not sliding
  slideProgress: number;
  revenge: boolean;
  ownerSlot: number;
  ownerCanPass: boolean; // owner still standing on it (prediction needs this)
}

export interface SnapshotData {
  tick: number;
  serverTimeMs: number;
  ackSeq: number; // last input seq the server has applied for THIS client
  players: SnapshotPlayer[];
  balloons: SnapshotBalloon[];
  splashes: { x: number; y: number; endTick: number }[];
  powerups: { x: number; y: number; type: PowerupType }[];
  tideRing: number;
}

export interface MatchEndPlayer {
  slot: number;
  playerId: string;
  nickname: string;
  placement: number; // 1..4
  roundsWon: number;
  soaks: number;
  revengeSoaks: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
  xpEarned: number;
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface MatchEndAwards {
  mostSoaks?: number; // slot
  castleCrusher?: number;
  longestSurvivor?: number;
  biggestChain?: number;
}

// ---------- Client → Server ----------

export type C2S =
  | { t: "hello"; token?: string }
  | { t: "set_nickname"; nickname: string }
  | { t: "set_cosmetics"; animal: string; hat: string }
  | { t: "tutorial_done" }
  | { t: "queue_join"; mode: GameMode }
  | { t: "queue_leave" }
  | { t: "create_room"; opts: CreateRoomOpts }
  | { t: "join_room"; code: string }
  | { t: "room_list_request" }
  | { t: "leave_room" }
  | { t: "set_slot"; slot: number; kind: "open" | "bot" | "closed"; difficulty?: BotDifficulty }
  | { t: "set_ready"; ready: boolean }
  | { t: "start_match" }
  | { t: "input"; seq: number; tick: number; dir: Dir; balloon: boolean }
  | { t: "emote"; id: number }
  | { t: "rematch_vote" }
  | { t: "pong"; ts: number };

// ---------- Server → Client ----------

export type S2C =
  | { t: "welcome"; profile: ProfileData; token: string }
  | { t: "error"; code: string; msg: string }
  | { t: "profile_update"; profile: ProfileData }
  | { t: "nickname_result"; ok: boolean; msg?: string }
  | { t: "queue_status"; mode: GameMode; waitingMs: number; searchRange: number; etaMs: number }
  | { t: "match_found"; mode: GameMode }
  | { t: "room_created"; code: string }
  | { t: "room_list"; rooms: RoomSummary[] }
  | {
      t: "lobby_state";
      code: string;
      name: string;
      mode: GameMode;
      isPublic: boolean;
      theme: MapTheme | "random";
      roundsToWin: number;
      hostSlot: number;
      yourSlot: number;
      slots: SlotInfo[];
    }
  | {
      t: "match_start";
      mode: GameMode;
      ranked: boolean;
      roundsToWin: number;
      theme: MapTheme;
      players: MatchPlayerInfo[];
      yourSlot: number; // -1 for pure spectators (unused in v1)
      rules: { enableKick: boolean; revengeDucks: boolean };
    }
  | {
      t: "round_start";
      roundNo: number;
      /** Cosmetic seed for client-side visual variation. NOT the sim seed —
       * hidden power-up contents are never derivable client-side. */
      mapSeed: number;
      castleGrid: number[];
      w: number;
      h: number;
      theme: MapTheme;
      startTick: number;
      introTicks: number;
      scores: number[]; // round wins per slot so far
    }
  | { t: "snapshot"; data: SnapshotData }
  | { t: "events"; tick: number; events: SimEvent[] }
  | { t: "emote"; slot: number; id: number }
  | { t: "round_end"; winnerSlot: number; draw: boolean; scores: number[] }
  | {
      t: "match_end";
      ranked: boolean;
      players: MatchEndPlayer[];
      awards: MatchEndAwards;
      rematchAvailable: boolean;
    }
  | { t: "rematch_state"; votes: number; needed: number; voted: boolean[] }
  | { t: "player_conn"; slot: number; connected: boolean; becameBot: boolean }
  | { t: "ping"; ts: number };

// ---------- Leaderboard / profile REST payloads ----------

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  nickname: string; // includes #tag
  rating: number;
  tier: string;
  games: number;
  winrate: number; // 0..1
}

export interface ProfileResponse {
  playerId: string;
  nickname: string;
  level: number;
  xp: number;
  ratings: Record<GameMode, { rating: number; games: number; wins: number; peak: number; tier: string }>;
  unlocks: string[];
  recentMatches: {
    mode: GameMode;
    ranked: boolean;
    placement: number;
    soaks: number;
    roundsWon: number;
    ratingBefore: number | null;
    ratingAfter: number | null;
    endedAt: number;
  }[];
}
