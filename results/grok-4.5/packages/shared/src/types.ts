import type { AnimalId, BotDifficulty, GameMode, HatId, MapTheme, MatchKind, PowerupType } from './config.js';

export type Dir = 'up' | 'down' | 'left' | 'right' | 'none';

export type TileType = 'empty' | 'boulder' | 'castle' | 'spawn';

export type PlayerState = {
  id: string;
  slot: number;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  speed: number;
  balloonCount: number;
  splashRange: number;
  balloonsOut: number;
  hasBoots: boolean;
  soaked: boolean;
  soakTick: number;
  alive: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  animal: AnimalId;
  hat: HatId;
  nickname: string;
  // Revenge duck state
  revenge: boolean;
  revengeCooldown: number;
  borderPos: number; // perimeter index when revenge
  soaks: number;
  castlesWashed: number;
  // Input
  inputSeq: number;
  lastInputTick: number;
};

export type Balloon = {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  placeTick: number;
  fuseTicks: number;
  splashRange: number;
  sliding: boolean;
  slideDir: Dir;
};

export type Splash = {
  tiles: Array<{ x: number; y: number }>;
  startTick: number;
  lingerTicks: number;
  chainDepth: number;
};

export type ExposedPowerup = {
  x: number;
  y: number;
  type: PowerupType;
};

export type HiddenPowerup = {
  x: number;
  y: number;
  type: PowerupType | null; // null = empty castle
};

export type GameEvent =
  | { type: 'castle_washed'; x: number; y: number }
  | { type: 'powerup_revealed'; x: number; y: number; powerup: PowerupType }
  | { type: 'powerup_collected'; playerId: string; x: number; y: number; powerup: PowerupType }
  | { type: 'player_soaked'; playerId: string; byPlayerId: string | null; tick: number }
  | { type: 'chain_burst'; depth: number; count: number }
  | { type: 'balloon_kicked'; balloonId: number; dir: Dir }
  | { type: 'tide_advance'; ring: number }
  | { type: 'revenge_lob'; playerId: string; x: number; y: number; dir: Dir }
  | { type: 'balloon_placed'; balloonId: number; x: number; y: number; ownerId: string }
  | { type: 'balloon_burst'; balloonId: number; x: number; y: number };

export type GameState = {
  tick: number;
  width: number;
  height: number;
  theme: MapTheme;
  mapSeed: number;
  /** 0=empty, 1=boulder, 2=castle */
  grid: number[];
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  powerups: ExposedPowerup[];
  hiddenPowerups: HiddenPowerup[];
  nextBalloonId: number;
  tideRing: number;
  events: GameEvent[];
  roundOver: boolean;
  winnerIds: string[]; // empty = draw or ongoing
  livingCount: number;
  ranked: boolean;
  enableRevengeDucks: boolean;
  enableKick: boolean;
};

export type PlayerInput = {
  seq: number;
  tick: number;
  dir: Dir;
  balloonPressed: boolean;
  emoteId?: number;
};

export type InputMap = Record<string, PlayerInput>;

export type RoomSlot = {
  kind: 'empty' | 'human' | 'bot';
  playerId?: string;
  nickname?: string;
  animal?: AnimalId;
  hat?: HatId;
  difficulty?: BotDifficulty;
  ready?: boolean;
  connected?: boolean;
};

export type RoomOptions = {
  name: string;
  size: 2 | 4;
  public: boolean;
  theme: MapTheme;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  mode: GameMode;
};

export type RoomInfo = {
  code: string;
  name: string;
  mode: GameMode;
  size: 2 | 4;
  players: number;
  maxPlayers: number;
  theme: MapTheme;
  host: string;
  public: boolean;
  inMatch: boolean;
};

export type Profile = {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  ratings: Record<GameMode, { rating: number; games: number; wins: number; peak: number }>;
  unlocks: string[];
};

export type MatchConfig = {
  matchId: string;
  mode: GameMode;
  kind: MatchKind;
  ranked: boolean;
  roundsToWin: number;
  theme: MapTheme;
  width: number;
  height: number;
  players: Array<{
    id: string;
    slot: number;
    nickname: string;
    animal: AnimalId;
    hat: HatId;
    isBot: boolean;
    rating?: number;
    tier?: string;
  }>;
};

export type Placement = {
  playerId: string;
  nickname: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  castlesWashed: number;
  ratingBefore?: number;
  ratingAfter?: number;
  xpEarned: number;
};

export type RoundResult = {
  roundNo: number;
  winnerIds: string[];
  soaks: Record<string, number>;
  draw: boolean;
};

export type FunStats = {
  mostSoaks: { playerId: string; nickname: string; value: number } | null;
  castleCrusher: { playerId: string; nickname: string; value: number } | null;
  longestSurvivor: { playerId: string; nickname: string; value: number } | null;
  biggestChain: number;
};

export function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export const DIR_DELTA: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  none: { dx: 0, dy: 0 },
};

export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
