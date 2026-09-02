import type { PowerupKind, BotDifficulty } from './config.js';

export type { PowerupKind, BotDifficulty };
export type GameMode = 'duel' | 'ffa';
export type MapTheme = 'backyard' | 'beach' | 'pool' | 'random';
export type AnimalId = 'frog' | 'duck' | 'otter' | 'penguin' | 'cat' | 'raccoon' | 'turtle' | 'capybara';
export type HatId = 'none' | 'bucket' | 'snorkel' | 'crown' | 'bandana' | 'propeller';

export const TILE_EMPTY = 0;
export const TILE_BOULDER = 1;
export const TILE_CASTLE = 2;

export interface PlayerInput {
  seq: number;
  tick: number;
  dx: number; // -1..1
  dy: number; // -1..1
  balloon: boolean;
  revengeLob?: boolean;
}

export interface PlayerState {
  id: string;
  slot: number;
  x: number; // float tile coords (top-left origin, center = +0.5)
  y: number;
  dirX: number;
  dirY: number;
  alive: boolean;
  isDuck: boolean;
  duckCooldown: number;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  activeBalloons: number; // derived but stored for validation
  roundsWon: number;
  soaks: number;
  castlesWashed: number;
  animal: AnimalId;
  hat: HatId;
  nickname: string;
  disconnected: boolean;
  lastMoveTick: number;
}

export interface BalloonState {
  id: number;
  tx: number;
  ty: number;
  ownerId: string;
  fuse: number; // ticks remaining
  range: number;
  slideX: number;
  slideY: number;
  slideT: number; // countdown to next tile step
  passThrough: Set<string> | string[]; // owner ids that may overlap (serialized as array)
}

export interface SplashCell {
  tx: number;
  ty: number;
  ttl: number;
}

export interface ExposedPowerup {
  tx: number;
  ty: number;
  kind: PowerupKind;
}

export interface GameState {
  tick: number;
  width: number;
  height: number;
  tiles: number[][]; // [y][x]
  /** Pre-rolled hidden contents per castle tile, null = empty. Keyed [y][x]. */
  contents: (PowerupKind | null)[][];
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashCell[];
  powerups: ExposedPowerup[];
  tideRing: number;
  tideTick: number;
  roundOver: boolean;
  roundWinner: string | string[] | null; // playerId, array for draw, null none
  nextBalloonId: number;
  seed: number;
  revengeDucks: boolean;
}

export type GameEventType =
  | 'castle_washed'
  | 'powerup_revealed'
  | 'powerup_collected'
  | 'player_soaked'
  | 'chain_burst'
  | 'balloon_kicked'
  | 'tide_advance'
  | 'revenge_lob'
  | 'balloon_placed'
  | 'balloon_burst';

export interface GameEvent {
  t: GameEventType;
  tick: number;
  a?: string;
  b?: string;
  tx?: number;
  ty?: number;
  kind?: string;
  count?: number;
  text?: string;
}

export interface RoundConfig {
  mode: GameMode;
  mapSeed: number;
  theme: MapTheme;
  roundsToWin: number;
  revengeDucks: boolean;
}
