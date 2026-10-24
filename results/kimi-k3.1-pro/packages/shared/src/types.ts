export type GameMode = "duel" | "ffa";
export type Direction = "up" | "down" | "left" | "right" | "none";
export type CardinalDirection = Exclude<Direction, "none">;
export type Theme = "backyard" | "beach" | "pool";
export type ThemeChoice = Theme | "random";
export type BotDifficulty = "easy" | "medium" | "hard";
export type Animal = "frog" | "duck" | "otter" | "penguin" | "cat" | "raccoon" | "turtle" | "capybara";
export type Hat = "none" | "bucket" | "snorkel" | "crown" | "bandana" | "propeller";
export type PowerUpType = "balloon" | "range" | "speed" | "kick";
export type GamePhase = "countdown" | "playing" | "round_end" | "match_end";

export const TILE = { FLOOR: 0, BOULDER: 1, CASTLE: 2 } as const;
export type TileValue = (typeof TILE)[keyof typeof TILE];

export interface MatchConfig {
  mode: GameMode;
  ranked: boolean;
  roundsToWin: number;
  theme: Theme;
  revengeDucks: boolean;
  kick: boolean;
  tutorial: boolean;
}

export interface MapData {
  width: number;
  height: number;
  tiles: TileValue[];
  hiddenPowerups: (PowerUpType | null)[];
  flooded: boolean[];
  spawns: { x: number; y: number }[];
}

export interface PlayerDescriptor {
  id: string;
  nickname: string;
  animal: Animal;
  hat: Hat;
  bot: boolean;
  difficulty?: BotDifficulty;
}

export interface PlayerState extends PlayerDescriptor {
  x: number;
  y: number;
  dir: Direction;
  speed: number;
  balloonCount: number;
  splashRange: number;
  kick: boolean;
  alive: boolean;
  roundsWon: number;
  soaks: number;
  castlesWashed: number;
  biggestChain: number;
  survivalTicks: number;
  totalSurvivalTicks: number;
  lastInputSeq: number;
  emote: number;
  emoteTick: number;
  revengePosition: number;
  revengeCooldown: number;
  ping: number;
}

export interface BalloonState {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  fuse: number;
  range: number;
  passThrough: string[];
  kickDir: CardinalDirection | null;
  direction: CardinalDirection;
  kickProgress: number;
  straight: boolean;
  revenge: boolean;
}

export interface SplashState {
  id: number;
  x: number;
  y: number;
  expiresAt: number;
  ownerId: string;
  chainDepth: number;
}

export interface PowerUpState {
  id: number;
  x: number;
  y: number;
  kind: PowerUpType;
  revealedTick: number;
}

export interface GameState {
  tick: number;
  roundStartedTick: number;
  round: number;
  phase: GamePhase;
  phaseTicks: number;
  matchSeed: number;
  mapSeed: number;
  config: MatchConfig;
  map: MapData;
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  powerups: PowerUpState[];
  tideRing: number;
  nextEntityId: number;
  roundWinnerId: string | null;
  lastSoakedTick: number;
}

export interface PlayerInput {
  seq: number;
  dir: Direction;
  balloonPressed: boolean;
}

export type GameEvent =
  | { type: "balloon_burst"; tick: number; balloonId: number; ownerId: string; x: number; y: number; chainDepth: number }
  | { type: "castle_washed"; tick: number; x: number; y: number; by: string | null }
  | { type: "powerup_revealed"; tick: number; id: number; x: number; y: number; kind: PowerUpType }
  | { type: "powerup_collected"; tick: number; id: number; playerId: string; kind: PowerUpType }
  | { type: "powerup_destroyed"; tick: number; id: number; x: number; y: number }
  | { type: "player_soaked"; tick: number; playerId: string; by: string | null; tide: boolean; chainDepth: number }
  | { type: "chain_burst"; tick: number; ownerId: string; depth: number; count: number; x: number; y: number }
  | { type: "balloon_kicked"; tick: number; balloonId: number; playerId: string; dir: CardinalDirection }
  | { type: "tide_advance"; tick: number; ring: number }
  | { type: "revenge_lob"; tick: number; playerId: string; balloonId: number }
  | { type: "balloon_dropped"; tick: number; balloonId: number; playerId: string; x: number; y: number }
  | { type: "emote"; tick: number; playerId: string; emote: number };

export interface Snapshot {
  tick: number;
  roundStartedTick: number;
  round: number;
  phase: GamePhase;
  phaseTicks: number;
  mapSeed: number;
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  powerups: PowerUpState[];
  tideRing: number;
  nextEntityId: number;
  roundWinnerId: string | null;
}

export interface PlayerProfile {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: Animal;
  selectedHat: Hat;
  unlocks: string[];
  nicknameSet: boolean;
  tutorialComplete: boolean;
}

export interface RatingInfo {
  mode: GameMode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface RoomListItem {
  code: string;
  name: string;
  mode: GameMode;
  players: number;
  maxPlayers: number;
  theme: Theme;
  host: string;
  inMatch: boolean;
}

export interface LobbySlot {
  slot: number;
  kind: "open" | "bot" | "human";
  playerId: string | null;
  nickname: string;
  animal: Animal;
  hat: Hat;
  difficulty: BotDifficulty | null;
  ready: boolean;
  connected: boolean;
}

export interface MatchPlacement {
  playerId: string;
  nickname: string;
  animal: Animal;
  placement: number;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  survivalTicks: number;
  biggestChain: number;
  xpEarned: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
}

export interface FunStats {
  mostSoaks: string | null;
  castleCrusher: string | null;
  longestSurvivor: string | null;
  biggestChain: string | null;
}
