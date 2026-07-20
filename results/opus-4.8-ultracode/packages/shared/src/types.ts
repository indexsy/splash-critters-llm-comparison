/**
 * Core game types — shared by sim, server and client.
 * The GameState here is the authoritative simulation state; the client runs the
 * identical sim over it for prediction.
 */

// ---- Enumerations ----

export type Mode = 'duel' | 'ffa';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type MapTheme = 'backyard' | 'beach' | 'pool';

export type AnimalId =
  | 'frog'
  | 'duck'
  | 'otter'
  | 'penguin'
  | 'cat'
  | 'raccoon'
  | 'turtle'
  | 'capybara';

export type HatId =
  | 'none'
  | 'bucket'
  | 'snorkel'
  | 'crown'
  | 'bandana'
  | 'propeller';

export type PowerUpType = 'extraBalloon' | 'bigSplash' | 'flippers' | 'rubberBoots';

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Tile kinds stored in the flat grid. */
export const Tile = {
  Empty: 0,
  Boulder: 1, // indestructible border + even/even pillars
  Sandcastle: 2, // destructible
  Flooded: 3, // rising-tide water (soaks anyone standing on it)
} as const;
export type TileValue = (typeof Tile)[keyof typeof Tile];

export const DIR_VECTORS: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const ALL_DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

// ---- Rank tiers ----

export interface RankTier {
  id: string;
  name: string;
  min: number;
  max: number;
}

// ---- Cosmetic / account identity carried into a match ----

export interface PlayerIdentity {
  id: string; // stable playerId (guest account)
  name: string; // "SoggyOtter#4821"
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  botDifficulty?: Difficulty;
  rating?: number; // shown on ranked VS card
  level?: number;
}

// ---- Live simulation entities ----

export interface Player {
  id: string;
  slot: number; // 0..3, drives spawn corner + HUD colour
  name: string;
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  botDifficulty?: Difficulty;
  connected: boolean;

  // continuous position in tile units (integer = tile centre)
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;

  alive: boolean;
  soakedTick: number; // tick they were soaked (for client fx); -1 if alive

  // upgradeable stats
  speed: number; // tiles/sec
  maxBalloons: number;
  range: number;
  hasKick: boolean;
  kickUsed: boolean; // boots are once-per-round

  activeBalloons: number; // currently-placed unburst balloons owned

  // per-round scoring
  soaks: number;
  castlesWashed: number;
  roundWins: number;

  // revenge duck state (eliminated players in casual)
  revenge: boolean;
  revengeT: number; // 0..1 position along the arena border for rendering
  revengeCooldown: number; // ticks until next lob allowed

  // emotes
  emoteId: number; // 0 = none, 1..4 = quack/ribbit/squeak/honk
  emoteUntilTick: number;
}

export interface Balloon {
  id: number;
  owner: string; // playerId
  x: number; // tile int (or fractional while sliding)
  y: number;
  fuseTick: number; // absolute tick when it bursts
  range: number;

  // kick sliding
  sliding: Dir | null;
  slideFrom: { x: number; y: number } | null; // for smooth render
  passableOwners: string[]; // players currently allowed to walk through it
}

/** A single lingering splash cell (used for soak + render). */
export interface SplashCell {
  x: number;
  y: number;
  expiresTick: number;
  ownerSlot: number; // colour of the splash for colourblind-safe palette
  center: boolean; // true for the burst origin tile
}

export interface GroundPowerUp {
  x: number;
  y: number;
  type: PowerUpType;
}

/** A revenge-duck lob (short-lived straight projectile). */
export interface RevengeLob {
  id: number;
  owner: string;
  x: number;
  y: number;
  dir: Dir;
  tilesLeft: number;
  stepTick: number; // next tick it advances a tile
}

export interface GameState {
  mode: Mode;
  width: number;
  height: number;
  tick: number;

  grid: number[]; // width*height, TileValue
  /** hidden pre-rolled contents per tile idx (null = nothing). Deterministic per seed. */
  castleContents: (PowerUpType | null)[];

  players: Player[];
  balloons: Balloon[];
  splashes: SplashCell[];
  powerups: GroundPowerUp[];
  revengeLobs: RevengeLob[];

  tideLevel: number; // rings flooded from the border (0 = none yet)
  mapSeed: number;
  roundNo: number;
  nextBalloonId: number;
  nextLobId: number;

  revengeEnabled: boolean;
  roundOver: boolean;
  winnerSlot: number | null; // slot that won the round, null = draw / ongoing
}

// ---- Player input (client -> sim) ----

export interface PlayerInput {
  seq: number; // client-assigned sequence number
  tick: number; // client's predicted tick when sampled
  dir: Dir | null;
  balloon: boolean; // rising-edge place request
}

/** Neutral input used when a player has no input this tick. */
export const NO_INPUT: PlayerInput = { seq: 0, tick: 0, dir: null, balloon: false };

// ---- Simulation events (sim -> netcode -> client fx) ----

export type SimEvent =
  | { t: 'balloon_placed'; x: number; y: number; owner: string }
  | { t: 'balloon_burst'; x: number; y: number; ownerSlot: number; cells: { x: number; y: number }[] }
  | { t: 'castle_washed'; x: number; y: number }
  | { t: 'powerup_revealed'; x: number; y: number; kind: PowerUpType }
  | { t: 'powerup_collected'; x: number; y: number; kind: PowerUpType; playerId: string }
  | { t: 'player_soaked'; playerId: string; bySlot: number; x: number; y: number }
  | { t: 'chain_burst'; count: number; x: number; y: number }
  | { t: 'balloon_kicked'; id: number; dir: Dir; x: number; y: number }
  | { t: 'tide_advance'; level: number }
  | { t: 'revenge_lob'; playerId: string; x: number; y: number; dir: Dir }
  | { t: 'emote'; playerId: string; emoteId: number };

// ---- Utility ----

export function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}
