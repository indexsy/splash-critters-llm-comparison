/** Core domain types shared by server, client and simulation. */

export type Mode = 'duel' | 'ffa';
export type Theme = 'backyard' | 'beach' | 'pool';
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
  | 'bucket_hat'
  | 'snorkel'
  | 'crown'
  | 'bandana'
  | 'propeller';
export type PowerupId = 'extra_balloon' | 'big_splash' | 'flippers' | 'boots';

export interface Vec2 {
  x: number;
  y: number;
}

/** Direction bitmask used by inputs: 1 up, 2 right, 4 down, 8 left. */
export const DIR_UP = 1;
export const DIR_RIGHT = 2;
export const DIR_DOWN = 4;
export const DIR_LEFT = 8;

/** Facing index 0..3 used for rendering: down, left, right, up. */
export type Facing = 0 | 1 | 2 | 3;

export interface Arena {
  width: number;
  height: number;
  theme: Theme;
  seed: number;
  /** 1 when the tile holds a sandcastle, 0 otherwise. */
  castles: number[];
  /** Hidden contents of each sandcastle (null = nothing inside). */
  contents: (PowerupId | null)[];
}

export interface DuckState {
  x: number;
  y: number;
  /** Distance travelled along the perimeter path (float). */
  dist: number;
  /** 0..3 facing index, used to aim revenge lobs. */
  dir: number;
  cooldown: number;
}

export interface PlayerState {
  id: number;
  animal: AnimalId;
  hat: HatId;
  alive: boolean;
  /** Continuous tile coordinates. */
  x: number;
  y: number;
  /** Facing index 0..3. */
  facing: Facing;
  moving: boolean;
  /** Last movement bitmask received (kept for remote prediction). */
  dir: number;
  speed: number;
  balloonCount: number;
  splashRange: number;
  flippers: number;
  hasBoots: boolean;
  bootsUsed: boolean;
  roundWins: number;
  soaks: number;
  revengeSoaks: number;
  castlesWashed: number;
  biggestChain: number;
  survivalTicks: number;
  eliminatedAtTick: number;
  duck: DuckState | null;
  /** True when the slot is driven by a server-side bot. */
  isBot: boolean;
  botDifficulty?: 'easy' | 'medium' | 'hard';
  nickname?: string;
  tag?: string;
  /** Last input sequence number applied by the server (used for reconciliation). */
  lastSeq: number;
  /** Set when the drop button was pressed; consumed on the next tick. */
  dropRequest: boolean;
  /** Ticks survived in the current round. */
  roundSurvivalTicks: number;
}

export interface Balloon {
  id: number;
  owner: number;
  x: number;
  y: number;
  /** Ticks left before the balloon bursts. */
  fuse: number;
  range: number;
  /** True when thrown by a ducked (revenge) player. */
  revenge: boolean;
  /** Sliding state for kicked balloons. */
  sliding: boolean;
  slideDir: number;
  slideCooldown: number;
}

export interface Splash {
  id: number;
  x: number;
  y: number;
  /** Tiles covered in [up, right, down, left] order at burst time. */
  lens: [number, number, number, number];
  /** Ticks of lingering left. */
  ticks: number;
  /** Chain depth (1 = solo burst, 2 = first chained burst, ...). */
  depth: number;
  owner: number;
  /** True when the splash came from a revenge duck lob. */
  revenge: boolean;
}

export interface ExposedPowerup {
  id: number;
  x: number;
  y: number;
  kind: PowerupId;
}

export type SimEvent =
  | { t: 'balloon_placed'; x: number; y: number; owner: number; revenge: boolean }
  | { t: 'castle_washed'; x: number; y: number; owner: number; depth: number }
  | { t: 'powerup_revealed'; x: number; y: number; kind: PowerupId }
  | { t: 'powerup_collected'; x: number; y: number; kind: PowerupId; player: number }
  | {
      t: 'player_soaked';
      player: number;
      by: number;
      x: number;
      y: number;
      revenge: boolean;
    }
  | { t: 'chain_burst'; depth: number; x: number; y: number; owner: number }
  | { t: 'balloon_kicked'; x: number; y: number; dir: number; by: number }
  | { t: 'tide_advance'; ring: number }
  | { t: 'revenge_lob'; x: number; y: number; dir: number; player: number }
  | { t: 'round_end'; winners: number[]; draw: boolean };

export type RoundPhase = 'countdown' | 'running' | 'round_over' | 'match_over';

export interface GameState {
  tick: number;
  arena: Arena;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  exposed: ExposedPowerup[];
  phase: RoundPhase;
  roundNo: number;
  roundsToWin: number;
  /** Countdown ticks remaining before the round goes live. */
  countdown: number;
  tideRing: number;
  /** Tick the tide starts flooding. */
  tideStartTick: number;
  /** Round timer ticks remaining (display only). */
  timeLeft: number;
  events: SimEvent[];
  nextEntityId: number;
  /** Deterministic rng state carried in the state blob. */
  rngState: number;
  /** True when revenge ducks are active this match. */
  revengeDucks: boolean;
  /** True when the balloon kick mechanic is active this match. */
  enableKick: boolean;
  /** Players that were soaked on the tick the round ended. */
  lastSoaked: number[];
}

export interface PlayerInput {
  playerId: number;
  seq: number;
  /** Movement bitmask. */
  dir: number;
  /** True on the tick the drop button was pressed. */
  balloon: boolean;
  /** Optional emote id (0..3). */
  emote?: number;
}

export interface MatchConfig {
  mode: Mode;
  roundsToWin: number;
  theme: Theme | 'random';
  ranked: boolean;
  enableRevengeDucks: boolean;
  enableKick: boolean;
}

export interface Placement {
  slot: number;
  playerId: string | null;
  nickname: string;
  tag: string;
  placement: number;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  biggestChain: number;
  survivedTicks: number;
}
