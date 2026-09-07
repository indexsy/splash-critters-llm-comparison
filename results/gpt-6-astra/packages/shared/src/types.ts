import type { CONFIG } from "./config.js";

export type Mode = "duel" | "ffa";
export type Theme = "backyard" | "beach" | "pool";
export type Difficulty = "easy" | "medium" | "hard";
export type Direction = "none" | "up" | "down" | "left" | "right";
export type PowerupKind = "balloon" | "range" | "speed" | "kick";
export type Animal = (typeof CONFIG.ANIMALS)[number]["id"];
export type Hat = (typeof CONFIG.HATS)[number]["id"];
export enum Tile {
  Floor = 0,
  Boulder = 1,
  Castle = 2,
  Flood = 3,
}
export interface Point {
  x: number;
  y: number;
}
export interface PlayerInput {
  seq: number;
  tick: number;
  dir: Direction;
  balloonPressed: boolean;
}
export interface PlayerState extends Point {
  id: string;
  nickname: string;
  animal: Animal;
  hat: Hat;
  slot: number;
  alive: boolean;
  dir: Direction;
  speed: number;
  balloonCount: number;
  splashRange: number;
  kick: boolean;
  soaks: number;
  castlesWashed: number;
  roundsWon: number;
  lastInputSeq: number;
  soakedAt: number | null;
  lastRevengeTick: number;
  biggestChain: number;
  survivalTicks: number;
  duckPos: number;
}
export interface Balloon extends Point {
  id: number;
  ownerId: string;
  placedTick: number;
  burstTick: number;
  range: number;
  passThrough: string[];
  slideDir: Direction;
  nextSlideTick: number;
  revenge: boolean;
}
export interface Splash extends Point {
  ownerId: string;
  expiresTick: number;
  revenge: boolean;
}
export interface Powerup extends Point {
  kind: PowerupKind;
  revealedTick: number;
}
export type GameEvent =
  | {
      type: "balloon_dropped";
      balloonId: number;
      playerId: string;
      x: number;
      y: number;
    }
  | {
      type: "balloon_burst";
      balloonId: number;
      playerId: string;
      x: number;
      y: number;
    }
  | { type: "castle_washed"; x: number; y: number; playerId: string }
  | { type: "powerup_revealed"; x: number; y: number; kind: PowerupKind }
  | {
      type: "powerup_collected";
      x: number;
      y: number;
      kind: PowerupKind;
      playerId: string;
    }
  | {
      type: "player_soaked";
      playerId: string;
      byId: string | null;
      revenge: boolean;
      x: number;
      y: number;
    }
  | {
      type: "chain_burst";
      count: number;
      playerId: string;
      x: number;
      y: number;
    }
  | {
      type: "balloon_kicked";
      balloonId: number;
      playerId: string;
      dir: Direction;
      x: number;
      y: number;
    }
  | { type: "tide_advance"; ring: number }
  | { type: "revenge_lob"; playerId: string; x: number; y: number }
  | { type: "emote"; playerId: string; id: number };
export interface GameState {
  tick: number;
  width: number;
  height: number;
  tiles: Tile[];
  hiddenPowerups: Record<number, PowerupKind>;
  mapSeed: number;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  powerups: Powerup[];
  tideRing: number;
  nextBalloonId: number;
  events: GameEvent[];
  roundOver: boolean;
  winnerId: string | null;
  ranked: boolean;
  revengeEnabled: boolean;
}
export interface PlayerSetup {
  id: string;
  nickname: string;
  animal?: Animal;
  hat?: Hat;
  roundsWon?: number;
}
export interface Rating {
  mode: Mode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}
export interface Profile {
  id: string;
  nickname: string;
  tag: string;
  nicknameSet: boolean;
  xp: number;
  level: number;
  selectedAnimal: Animal;
  selectedHat: Hat;
  ratings: Rating[];
  unlocks: string[];
  tutorialComplete: boolean;
}
export interface RoomOptions {
  name: string;
  mode: Mode;
  isPublic: boolean;
  theme: Theme | "random";
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  practice?: boolean;
  tutorial?: boolean;
}
export interface LobbySlot {
  slot: number;
  kind: "open" | "human" | "bot";
  playerId: string | null;
  nickname: string;
  animal: Animal;
  hat: Hat;
  ready: boolean;
  difficulty: Difficulty;
  connected: boolean;
  rating: number;
}
export interface LobbyState {
  code: string;
  hostId: string;
  opts: RoomOptions;
  slots: LobbySlot[];
  status: "lobby" | "playing" | "results";
  ranked: boolean;
  rematchVotes: string[];
}
export interface RoomSummary {
  code: string;
  name: string;
  mode: Mode;
  players: number;
  max: number;
  bots: number;
  theme: Theme | "random";
  host: string;
}
export interface MatchConfig {
  id: string;
  code: string;
  mode: Mode;
  ranked: boolean;
  roundsToWin: number;
  players: LobbySlot[];
  theme: Theme;
}
export interface Snapshot {
  tick: number;
  serverTime: number;
  roundNo: number;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  powerups: Powerup[];
  tideRing: number;
  roundOver: boolean;
  countdown: number;
  tutorialGoals?: string[];
}
export interface Placement {
  playerId: string;
  nickname: string;
  animal: Animal;
  placement: number;
  roundsWon: number;
  soaks: number;
  castlesWashed: number;
  survivalTicks: number;
  biggestChain: number;
  forfeited: boolean;
}
export interface MatchResult {
  matchId: string;
  ranked: boolean;
  mode: Mode;
  placements: Placement[];
  ratingDeltas: Record<string, { before: number; after: number }>;
  xp: Record<string, number>;
}
export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
  animal: Animal;
}
export interface RecentMatch {
  id: string;
  mode: Mode;
  ranked: boolean;
  endedAt: number;
  placement: number;
  soaks: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}
