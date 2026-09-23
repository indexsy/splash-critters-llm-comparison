// Core domain types shared by server (authority) and client (prediction + rendering).
// Numeric code objects (Tile, Dir, PowerUp) are used instead of TS enums so they survive
// isolatedModules bundling and serialize compactly.

// ---------------------------------------------------------------------------
// Identifiers & enumerations
// ---------------------------------------------------------------------------

export type Mode = 'duel' | 'ffa';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Theme = 'backyard' | 'beach' | 'pool';
export type ThemeChoice = Theme | 'random';
export type AnimalId = 'frog' | 'duck' | 'otter' | 'penguin' | 'cat' | 'raccoon' | 'turtle' | 'capybara';
export type HatId = 'none' | 'bucket' | 'snorkel' | 'crown' | 'bandana' | 'propeller';
export type TierId = 'puddle' | 'pond' | 'river' | 'lake' | 'ocean' | 'tsunami';
/** 0 quack, 1 ribbit, 2 squeak, 3 honk (keys 1-4). */
export type EmoteId = 0 | 1 | 2 | 3;

export const Tile = { Floor: 0, Boulder: 1, Castle: 2 } as const;
export type TileKind = (typeof Tile)[keyof typeof Tile];

export const Dir = { None: 0, Up: 1, Down: 2, Left: 3, Right: 4 } as const;
export type DirCode = (typeof Dir)[keyof typeof Dir];

export const PowerUp = { None: 0, Balloon: 1, Range: 2, Speed: 3, Boots: 4 } as const;
export type PowerUpKind = (typeof PowerUp)[keyof typeof PowerUp];

// ---------------------------------------------------------------------------
// Simulation state (see ARCHITECTURE.md "Simulation rules" for semantics)
// All positions are integers in sub-tile units: CONFIG.SUB units per tile.
// A tile (tx,ty) spans [tx*SUB, (tx+1)*SUB); its center is tx*SUB + SUB/2.
// ---------------------------------------------------------------------------

export interface SimRules {
  kick: boolean;
  revengeDucks: boolean;
  tide: boolean;
  /** Tick at which the rising tide starts (CONFIG.TIDE_START_TICKS normally). */
  tideStartTick: number;
  /** Tutorial sandbox: the sim never ends the round; the server revives soaked players. */
  sandbox: boolean;
}

export interface PlayerInput {
  /** Monotonic per-client sequence number (server acks the last applied seq). */
  seq: number;
  dir: DirCode;
  /** True only on the tick the balloon key was pressed (edge, not held). */
  balloon: boolean;
}

export interface RoundStats {
  /** Opponents soaked by this player's (non-duck) balloons. Self-soaks do not count. */
  soaks: number;
  /** Players soaked by this player's revenge-duck lobs (stats only, scores nothing). */
  revengeSoaks: number;
  castles: number;
  biggestChain: number;
  powerups: number;
  selfSoaked: boolean;
}

export interface PlayerState {
  slot: number;
  /** False for empty/closed slots that never joined the round. */
  present: boolean;
  x: number;
  y: number;
  facing: DirCode;
  moving: boolean;
  alive: boolean;
  speedUps: number;
  maxBalloons: number;
  range: number;
  canKick: boolean;
  /** Tick the player was soaked, -1 while dry. */
  soakedTick: number;
  /** Slot that soaked this player; -1 = tide; own slot = self-soak. */
  soakedBy: number;
  /** Position along the border loop in sub-units (see ducks helpers); -1 = no duck. */
  duckPos: number;
  duckCooldownUntil: number;
  stats: RoundStats;
}

export interface Balloon {
  id: number;
  /** Slot of the thrower (duck owner for revenge lobs). */
  owner: number;
  tx: number;
  ty: number;
  /** Sub-unit center; differs from the tile center only while sliding after a kick. */
  x: number;
  y: number;
  placedTick: number;
  burstTick: number;
  range: number;
  /** Dir.None when stationary. */
  slideDir: DirCode;
  /** Bitmask of slots allowed to overlap this balloon's tile (walk-off rule). */
  passMask: number;
  fromDuck: boolean;
}

export interface Splash {
  id: number;
  owner: number;
  cx: number;
  cy: number;
  /** Tiles reached beyond the center: [up, down, left, right]. */
  arms: [number, number, number, number];
  startTick: number;
  /** Exclusive end tick (startTick + SPLASH_TICKS). */
  endTick: number;
  /** Cascade id shared by every balloon burst in the same chain. */
  chainId: number;
  fromDuck: boolean;
}

export interface RoundState {
  w: number;
  h: number;
  /** Ticks elapsed since the round went live (tick 0 = first playable tick). */
  tick: number;
  tiles: Uint8Array; // TileKind per tile, row-major (i = y*w + x)
  /** Hidden power-up inside each castle. SERVER ONLY: always zero-filled on clients. */
  hidden: Uint8Array;
  /** Exposed power-up per tile (PowerUp.None when empty). */
  items: Uint8Array;
  /** Tick (exclusive) until which a tile is covered by splash water. */
  splashUntil: Int32Array;
  /** Slot credited for the splash covering a tile (last writer wins), -1 none. */
  splashOwner: Int8Array;
  /** 1 if the splash covering the tile came from a revenge-duck balloon. */
  splashDuck: Uint8Array;
  /** 0 = no tide yet; level L floods every tile whose ring index is 1..L. */
  tideLevel: number;
  nextTideTick: number;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  nextId: number;
  rules: SimRules;
  over: boolean;
  /** Tick on which the round ended, -1 while it is still being played. */
  overTick: number;
  /** Winning slot, -1 for a draw (or while not over). */
  winner: number;
}

// ---------------------------------------------------------------------------
// Sim events (emitted by simulateTick, relayed to clients inside `event` messages)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'balloon_placed'; id: number; x: number; y: number; owner: number }
  | { type: 'balloon_burst'; id: number; x: number; y: number; owner: number; arms: [number, number, number, number]; chainId: number; fromDuck: boolean }
  | { type: 'balloon_fizzled'; id: number; x: number; y: number }
  | { type: 'castle_washed'; x: number; y: number; by: number }
  | { type: 'powerup_revealed'; x: number; y: number; kind: PowerUpKind }
  | { type: 'powerup_collected'; x: number; y: number; kind: PowerUpKind; slot: number }
  | { type: 'powerup_destroyed'; x: number; y: number; kind: PowerUpKind }
  | { type: 'player_soaked'; slot: number; by: number; cause: 'splash' | 'tide' | 'revenge'; x: number; y: number }
  | { type: 'chain_burst'; count: number; x: number; y: number; owner: number; chainId: number }
  | { type: 'balloon_kicked'; id: number; slot: number; dir: DirCode }
  | { type: 'balloon_stopped'; id: number; x: number; y: number }
  | { type: 'tide_advance'; level: number }
  | { type: 'revenge_lob'; slot: number; id: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'round_over'; winner: number; draw: boolean };

// ---------------------------------------------------------------------------
// Snapshot DTOs (wire format for dynamic state, 15 Hz)
// ---------------------------------------------------------------------------

export interface PlayerSnap {
  slot: number;
  x: number;
  y: number;
  facing: DirCode;
  moving: boolean;
  alive: boolean;
  speedUps: number;
  maxBalloons: number;
  range: number;
  canKick: boolean;
  soakedTick: number;
  duckPos: number;
  duckCooldownUntil: number;
  /** Balloons this player currently has on the field. */
  activeBalloons: number;
}

export interface ItemSnap {
  x: number;
  y: number;
  kind: PowerUpKind;
}

// ---------------------------------------------------------------------------
// Profiles, ratings, progression
// ---------------------------------------------------------------------------

export interface RatingInfo {
  mode: Mode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
  tier: TierId;
}

export interface Profile {
  id: string;
  nickname: string;
  tag: string; // 4 digits, displayed as nickname#tag
  /** False while still using the generated guest name (ranked requires true). */
  hasNickname: boolean;
  xp: number; // lifetime total
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  animal: AnimalId;
  hat: HatId;
  /** Unlocked cosmetic item ids (AnimalId | HatId values). */
  unlocks: string[];
  ratings: Record<Mode, RatingInfo>;
  tutorialDone: boolean;
  createdAt: number;
}

export interface RecentMatch {
  matchId: string;
  mode: Mode;
  ranked: boolean;
  endedAt: number;
  placement: number;
  players: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
}

export interface PublicProfile {
  id: string;
  nickname: string;
  tag: string;
  level: number;
  xp: number;
  animal: AnimalId;
  hat: HatId;
  unlocks: string[];
  ratings: Record<Mode, RatingInfo>;
  recentMatches: RecentMatch[];
  createdAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  tag: string;
  rating: number;
  tier: TierId;
  games: number;
  wins: number;
  /** 0..1 */
  winrate: number;
  animal: AnimalId;
}

// ---------------------------------------------------------------------------
// Rooms, lobbies, matches
// ---------------------------------------------------------------------------

export interface CreateRoomOpts {
  name: string;
  /** 2 = duel arena (13x11), 4 = FFA arena (15x13). */
  size: 2 | 4;
  isPublic: boolean;
  theme: ThemeChoice;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  /** Practice vs Bots: private solo room, every other slot a bot, auto-starts. */
  practice?: boolean;
  practiceDifficulty?: Difficulty;
}

export type SlotKind = 'open' | 'human' | 'bot' | 'closed';

export interface SlotView {
  slot: number;
  kind: SlotKind;
  playerId?: string;
  name?: string;
  tag?: string;
  animal?: AnimalId;
  hat?: HatId;
  difficulty?: Difficulty;
  level?: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

export type RoomPhase = 'lobby' | 'in_match' | 'results';

export interface LobbyState {
  code: string;
  name: string;
  mode: Mode;
  size: 2 | 4;
  isPublic: boolean;
  practice: boolean;
  theme: ThemeChoice;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  phase: RoomPhase;
  slots: SlotView[];
  hostSlot: number;
  yourSlot: number;
  /** Slots that voted for a rematch (phase 'results'). */
  rematchVotes: number[];
  /** Server time (ms) when the rematch vote closes; 0 when no vote is open. */
  rematchDeadline: number;
  /** Shareable path, e.g. "/#/room/ABC123". */
  link: string;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: Mode;
  players: number; // humans + bots currently seated
  maxPlayers: number;
  theme: ThemeChoice;
  host: string; // nickname#tag
  inMatch: boolean;
  joinable: boolean;
}

export interface MatchPlayerInfo {
  slot: number;
  playerId: string | null; // null for bots
  name: string;
  tag: string;
  isBot: boolean;
  difficulty?: Difficulty;
  animal: AnimalId;
  hat: HatId;
  level: number;
  /** Ranked only. */
  rating?: number;
  tier?: TierId;
}

export interface MatchConfig {
  matchId: string;
  mode: Mode;
  ranked: boolean;
  practice: boolean;
  tutorial: boolean;
  roomCode: string;
  roundsToWin: number;
  theme: ThemeChoice;
  w: number;
  h: number;
  rules: SimRules;
  players: MatchPlayerInfo[];
  yourSlot: number;
}

export interface PlayerRoundSummary {
  slot: number;
  alive: boolean;
  soaks: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
}

export interface PlacementEntry {
  slot: number;
  playerId: string | null;
  name: string;
  tag: string;
  isBot: boolean;
  animal: AnimalId;
  hat: HatId;
  placement: number; // 1-based; ties share a placement
  roundsWon: number;
  soaks: number;
  revengeSoaks: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
  forfeited: boolean;
}

export interface RatingDelta {
  slot: number;
  playerId: string;
  before: number;
  after: number;
  delta: number;
  tierBefore: TierId;
  tierAfter: TierId;
}

export interface XpAward {
  slot: number;
  playerId: string;
  earned: number;
  breakdown: { label: string; xp: number }[];
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  /** Cosmetic ids newly unlocked by this award. */
  unlocked: string[];
}

export type FunStatId = 'most_soaks' | 'castle_crusher' | 'longest_survivor' | 'biggest_chain';

export interface FunStat {
  id: FunStatId;
  label: string;
  slot: number;
  value: number;
}
