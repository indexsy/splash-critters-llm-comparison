/** Core value types shared by the simulation, the wire protocol and the UI. */

// ------------------------------------------------------------------ identifiers

export type AnimalId =
  | 'frog'
  | 'duck'
  | 'otter'
  | 'penguin'
  | 'cat'
  | 'raccoon'
  | 'turtle'
  | 'capybara';

export type HatId = 'none' | 'bucket' | 'snorkel' | 'crown' | 'bandana' | 'propeller';

export type MapTheme = 'backyard' | 'beach' | 'pool';

export type RankTierId = 'puddle' | 'pond' | 'river' | 'lake' | 'ocean' | 'tsunami';

export type GameMode = 'duel' | 'ffa';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export type PowerupType = 'extra_balloon' | 'big_splash' | 'flippers' | 'boots';

// ------------------------------------------------------------------------ grid

export const Tile = {
  EMPTY: 0,
  BOULDER: 1,
  CASTLE: 2,
  WATER: 3,
} as const;
export type TileValue = (typeof Tile)[keyof typeof Tile];

export const Dir = {
  NONE: 0,
  UP: 1,
  RIGHT: 2,
  DOWN: 3,
  LEFT: 4,
} as const;
export type DirValue = (typeof Dir)[keyof typeof Dir];

/** Index by DirValue. Entry 0 (NONE) is the zero vector. */
export const DIR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The four real directions, in a fixed order for deterministic iteration. */
export const CARDINALS: ReadonlyArray<DirValue> = [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT];

export function oppositeDir(dir: DirValue): DirValue {
  switch (dir) {
    case Dir.UP:
      return Dir.DOWN;
    case Dir.DOWN:
      return Dir.UP;
    case Dir.LEFT:
      return Dir.RIGHT;
    case Dir.RIGHT:
      return Dir.LEFT;
    default:
      return Dir.NONE;
  }
}

// ------------------------------------------------------------------ simulation

export type RoundPhase = 'countdown' | 'playing' | 'ended';

export interface PlayerInput {
  /** Monotonic per-client sequence number, used for acknowledgement. */
  seq: number;
  /** Tick the client believes it is simulating. */
  tick: number;
  dir: DirValue;
  balloonPressed: boolean;
}

export const EMPTY_INPUT: PlayerInput = { seq: 0, tick: 0, dir: Dir.NONE, balloonPressed: false };

export interface PlayerState {
  id: number;
  /** Tile-space position of the critter's centre. */
  x: number;
  y: number;
  facing: DirValue;
  /** False once soaked. */
  alive: boolean;
  /** Set on the tick the player was soaked, for the death animation. */
  soakedAtTick: number;
  /** Tiles per second. */
  speed: number;
  /** Maximum simultaneous live balloons. */
  balloonCount: number;
  /** Splash reach per direction, in tiles. */
  splashRange: number;
  /** Rubber Boots collected this round. */
  hasKick: boolean;
  /** Live balloons owned by this player. */
  activeBalloons: number;
  /** True while the critter is walking (drives the 2-frame cycle). */
  moving: boolean;
  /** Ticks remaining on the current emote bubble, 0 when hidden. */
  emoteId: number;
  emoteTicks: number;
  emoteCooldown: number;
  // ------- revenge duck state (only meaningful once `alive` is false)
  ghost: boolean;
  /** Distance travelled clockwise along the arena border, in tiles. */
  ghostPos: number;
  ghostCooldown: number;
  // ------- per-round stats
  soaks: number;
  castlesWashed: number;
  bestChain: number;
  survivedTicks: number;
}

export interface Balloon {
  id: number;
  ownerId: number;
  /** Tile-space centre. Integer + 0.5 unless sliding after a kick. */
  x: number;
  y: number;
  /** Absolute tick at which the balloon bursts on its own. */
  burstTick: number;
  range: number;
  /** Dir.NONE unless currently sliding from a kick. */
  slideDir: DirValue;
  /** Players that may currently walk through this balloon. */
  passThrough: number[];
  /**
   * Whether this balloon occupies one of its owner's balloon slots. Revenge-duck
   * lobs are owned by a soaked player but must not eat a live player's budget.
   */
  counted: boolean;
}

export interface Splash {
  id: number;
  ownerId: number;
  /** Centre tile. */
  x: number;
  y: number;
  /** Reach actually achieved per direction, indexed by DirValue. */
  arms: [number, number, number, number, number];
  /** True where the arm was cut short by a wall/castle/balloon (tip sprite). */
  capped: [boolean, boolean, boolean, boolean, boolean];
  endTick: number;
}

export interface Powerup {
  id: number;
  type: PowerupType;
  x: number;
  y: number;
}

/** A revenge-duck balloon in flight toward the arena. */
export interface Lob {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  dir: DirValue;
  /** Tiles left before it lands. */
  remaining: number;
}

export interface GameState {
  tick: number;
  width: number;
  height: number;
  /** Row-major TileValue grid, length = width * height. */
  cells: Uint8Array;
  /**
   * Hidden power-up contents of every castle, pre-rolled at map generation.
   * 0 = nothing, otherwise index+1 into CONFIG.POWERUP_WEIGHTS. Never sent to
   * clients until the castle is washed away.
   */
  castleContents: Uint8Array;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  powerups: Powerup[];
  lobs: Lob[];
  /** Index into `tideOrder` of the next tile to flood. */
  tideCursor: number;
  /** Precomputed flood order: tile index + absolute tick it floods. */
  tideOrder: Int32Array;
  tideTicks: Int32Array;
  phase: RoundPhase;
  /** Tick at which the current phase ends (countdown / round-end freeze). */
  phaseEndTick: number;
  /** Populated when the round ends. Empty array = draw. */
  winners: number[];
  /** Whether revenge ducks are active for this match. */
  revengeDucks: boolean;
  kickEnabled: boolean;
  nextEntityId: number;
  /** Events produced by the tick just simulated; drained by the caller. */
  events: SimEvent[];
}

// ---------------------------------------------------------------------- events

export interface CastleWashedEvent {
  kind: 'castle_washed';
  x: number;
  y: number;
  byPlayerId: number;
}
export interface PowerupRevealedEvent {
  kind: 'powerup_revealed';
  id: number;
  type: PowerupType;
  x: number;
  y: number;
}
export interface PowerupCollectedEvent {
  kind: 'powerup_collected';
  id: number;
  type: PowerupType;
  playerId: number;
}
export interface PowerupDestroyedEvent {
  kind: 'powerup_destroyed';
  id: number;
  x: number;
  y: number;
}
export interface PlayerSoakedEvent {
  kind: 'player_soaked';
  playerId: number;
  /** -1 when soaked by the rising tide. */
  byPlayerId: number;
  byTide: boolean;
  x: number;
  y: number;
}
export interface BalloonPlacedEvent {
  kind: 'balloon_placed';
  id: number;
  playerId: number;
  x: number;
  y: number;
}
export interface BalloonBurstEvent {
  kind: 'balloon_burst';
  id: number;
  x: number;
  y: number;
}
export interface ChainBurstEvent {
  kind: 'chain_burst';
  /** Number of balloons that burst together in this cascade. */
  count: number;
  playerId: number;
  x: number;
  y: number;
}
export interface BalloonKickedEvent {
  kind: 'balloon_kicked';
  id: number;
  playerId: number;
  dir: DirValue;
}
export interface TideAdvanceEvent {
  kind: 'tide_advance';
  tiles: number[];
}
export interface TideWarningEvent {
  kind: 'tide_warning';
}
export interface RevengeLobEvent {
  kind: 'revenge_lob';
  playerId: number;
  x: number;
  y: number;
  dir: DirValue;
}
export interface EmoteEvent {
  kind: 'emote';
  playerId: number;
  emoteId: number;
}
export interface RoundOverEvent {
  kind: 'round_over';
  winners: number[];
}

export type SimEvent =
  | CastleWashedEvent
  | PowerupRevealedEvent
  | PowerupCollectedEvent
  | PowerupDestroyedEvent
  | PlayerSoakedEvent
  | BalloonPlacedEvent
  | BalloonBurstEvent
  | ChainBurstEvent
  | BalloonKickedEvent
  | TideAdvanceEvent
  | TideWarningEvent
  | RevengeLobEvent
  | EmoteEvent
  | RoundOverEvent;

// ------------------------------------------------------------------- profiles

export interface RatingInfo {
  mode: GameMode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface PlayerProfile {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  unlocks: string[];
  ratings: RatingInfo[];
  /** Set once the player has finished (or skipped) the tutorial. */
  tutorialDone: boolean;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  nickname: string;
  tag: string;
  rating: number;
  tier: RankTierId;
  games: number;
  wins: number;
  winrate: number;
}

export interface MatchHistoryRow {
  matchId: string;
  mode: GameMode;
  ranked: boolean;
  endedAt: number;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}
