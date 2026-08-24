import type { MapTheme } from "./config";

export type GameMode = "duel" | "ffa";
export type BotDifficulty = "easy" | "medium" | "hard";
export type SlotKind = "open" | "human" | "bot";
export type PowerupType = "balloon" | "range" | "speed" | "boots";

export interface Vec2 {
  x: number;
  y: number;
}

/** Tile contents for a castle: what's hidden inside (pre-rolled at map gen). */
export interface HiddenPowerup {
  tile: number; // y * w + x
  type: PowerupType | null;
}

export interface MatchConfig {
  mode: GameMode;
  ranked: boolean;
  theme: MapTheme;
  roundsToWin: number;
  w: number;
  h: number;
  maxPlayers: number;
  enableKick: boolean;
  enableRevengeDucks: boolean;
  mapSeed: number;
}

export interface PlayerState {
  id: string; // entity id within sim
  x: number;
  y: number; // float position in tiles
  dirX: number;
  dirY: number;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  alive: boolean;
  soakedTick: number | null;
  moving: boolean;
  revengeReady: boolean;
  revengeCooldown: number;
  castlesWashed: number;
  soaks: number;
  revengeSoaks: number;
  prevBalloonPressed: boolean;
  /** Tile index of the player's own balloon they may still walk off. */
  onBalloonTile: number | null;
  /** walking into a balloon kicks it (true for humans, false for bots) */
  autoKick: boolean;
  spawnX: number;
  spawnY: number;
}

export interface BalloonState {
  id: number;
  owner: string;
  x: number;
  y: number; // integer tiles
  fuse: number; // ticks remaining
  range: number;
  sliding: boolean;
  slideDirX: number;
  slideDirY: number;
  slideProgress: number; // 0..1 between tiles while sliding
  chainDepth: number;
}

export interface SplashState {
  id: number;
  x: number;
  y: number;
  age: number; // ticks since burst
  cells: number[]; // tile indices covered
  owner: string;
}

export interface ExposedPowerup {
  id: number;
  x: number;
  y: number;
  type: PowerupType;
}

export interface SimEvent {
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
  dirX?: number;
  dirY?: number;
  revenge?: boolean;
}

export interface SimPlayerInput {
  seq: number;
  tick: number;
  dirX: number; // -1..1 (8-dir)
  dirY: number;
  balloonPressed: boolean;
  emote?: number;
}

export interface SimState {
  tick: number;
  config: MatchConfig;
  grid: Uint8Array; // per-tile: 0 floor, 1 boulder, 2 sandcastle, 3 flooded
  hidden: HiddenPowerup[];
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  exposed: ExposedPowerup[];
  tideRing: number; // how many perimeter rings flooded
  events: SimEvent[];
  roundOver: boolean;
  winnerIds: string[];
  nextId: number;
  rngState: number; // carried so replayable if needed at runtime
}

export interface SnapshotPayload {
  tick: number;
  players: Array<{
    id: string;
    x: number;
    y: number;
    alive: boolean;
    stats: { speed: number; balloons: number; range: number };
    hasBoots: boolean;
    moving: boolean;
    revengeCooldown: number;
  }>;
  balloons: Array<{
    id: number;
    owner: string;
    x: number;
    y: number;
    fuse: number;
    sliding: boolean;
    dx: number;
    dy: number;
    progress: number;
    range: number;
  }>;
  splashes: Array<{ id: number; x: number; y: number; age: number; cells: number[] }>;
  exposed: Array<{ id: number; x: number; y: number; type: PowerupType }>;
  tideRing: number;
}
