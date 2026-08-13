import type { AnimalId, HatId, MapTheme, ResolvedTheme } from "./config.js";

export type Mode = "duel" | "ffa";
export type BotDifficulty = "easy" | "medium" | "hard";
export type SlotKind = "empty" | "human" | "bot";
export type Dir = "up" | "down" | "left" | "right" | "none";
export type TileKind = "empty" | "boulder" | "castle" | "spawn";
export type PowerupKind = "extraBalloon" | "bigSplash" | "flippers" | "rubberBoots";
export type PlayerStatus = "alive" | "soaked" | "revenge";

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerInput {
  seq: number;
  tick: number;
  dir: Dir;
  balloonPressed: boolean;
}

export interface PlayerState {
  id: string;
  slot: number;
  nickname: string;
  tag: number;
  animal: AnimalId;
  hat: HatId;
  x: number;
  y: number;
  dir: Dir;
  speed: number;
  balloonCount: number;
  splashRange: number;
  balloonsOut: number;
  hasKick: boolean;
  status: PlayerStatus;
  soakTick: number;
  revengeCooldown: number;
  soaks: number;
  castlesWashed: number;
  survivedTicks: number;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
}

export interface BalloonState {
  id: number;
  ownerId: string;
  tx: number;
  ty: number;
  fuseLeft: number;
  range: number;
  sliding: boolean;
  slideDir: Dir;
}

export interface SplashState {
  id: number;
  tx: number;
  ty: number;
  ticksLeft: number;
  ownerId: string;
  isCenter: boolean;
}

export interface ExposedPowerup {
  tx: number;
  ty: number;
  kind: PowerupKind;
}

export interface HiddenPowerup {
  tx: number;
  ty: number;
  kind: PowerupKind;
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
    | "balloon_placed"
    | "balloon_burst"
    | "round_draw";
  tick: number;
  [k: string]: unknown;
}

export interface ArenaState {
  width: number;
  height: number;
  tiles: TileKind[];
  theme: ResolvedTheme;
  seed: number;
}

export interface RoundState {
  tick: number;
  arena: ArenaState;
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  exposed: ExposedPowerup[];
  hidden: HiddenPowerup[];
  tideRing: number;
  nextBalloonId: number;
  nextSplashId: number;
  events: SimEvent[];
  hitstop: number;
  ended: boolean;
  winnerIds: string[];
  draw: boolean;
}

export interface MatchConfig {
  mode: Mode;
  ranked: boolean;
  roundsToWin: number;
  theme: MapTheme;
  enableKick: boolean;
  enableRevengeDucks: boolean;
  width: number;
  height: number;
}

export interface SlotState {
  index: number;
  kind: SlotKind;
  playerId?: string;
  nickname?: string;
  tag?: number;
  animal?: AnimalId;
  hat?: HatId;
  difficulty?: BotDifficulty;
  ready: boolean;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  name: string;
  mode: Mode;
  public: boolean;
  playerCount: number;
  maxPlayers: number;
  theme: MapTheme;
  hostName: string;
  inMatch: boolean;
}

export interface Profile {
  id: string;
  nickname: string;
  tag: number;
  xp: number;
  level: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  ratings: Record<Mode, RatingRow>;
  unlocks: string[];
}

export interface RatingRow {
  mode: Mode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  tag: number;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}

export function tileIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

export function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function dirVec(dir: Dir): Vec2 {
  switch (dir) {
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

export function oppositeDir(dir: Dir): Dir {
  switch (dir) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
    default:
      return "none";
  }
}
