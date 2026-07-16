export type Dir = 0 | 1 | 2 | 3 | 4;
export const DIR_NONE: Dir = 0;
export const DIR_UP: Dir = 1;
export const DIR_RIGHT: Dir = 2;
export const DIR_DOWN: Dir = 3;
export const DIR_LEFT: Dir = 4;

export const DIR_VECTORS: Record<1 | 2 | 3 | 4, { x: number; y: number }> = {
  1: { x: 0, y: -1 },
  2: { x: 1, y: 0 },
  3: { x: 0, y: 1 },
  4: { x: -1, y: 0 },
};

export type Tile = 0 | 1 | 2;
export const TILE_FLOOR: Tile = 0;
export const TILE_BOULDER: Tile = 1;
export const TILE_CASTLE: Tile = 2;

export type PowerUpKind = 'balloon' | 'range' | 'speed' | 'boots';
export type AnimalId = 'frog' | 'duck' | 'otter' | 'penguin' | 'cat' | 'raccoon' | 'turtle' | 'capybara';
export type HatId = 'none' | 'bucket' | 'snorkel' | 'crown' | 'bandana' | 'propeller';
export type ThemeId = 'backyard' | 'beach' | 'pool';
export type GameMode = 'duel' | 'ffa';
export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface InputFrame {
  seq: number;
  dir: Dir;
  balloon: boolean;
}

export interface PlayerState {
  slot: number;
  x: number;
  y: number;
  alive: boolean;
  dir: Dir;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  activeBalloons: number;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  longestAliveTicks: number;
  roundAliveTicks: number;
  overlappedBalloonIds: number[];
  isDuck: boolean;
  duckPos: number;
  duckLastLobTick: number;
  emoteId: number;
  emoteUntilTick: number;
}

export interface BalloonState {
  id: number;
  ownerSlot: number;
  tx: number;
  ty: number;
  fx: number;
  fy: number;
  slideDir: Dir;
  placedTick: number;
  burstTick: number;
  flying: boolean;
  flyDir: Dir;
  flyTilesLeft: number;
}

export interface SplashState {
  tiles: number[];
  untilTick: number;
  ownerSlot: number;
  depth: number;
  group: number;
}

export interface ExposedPowerUp {
  id: number;
  tx: number;
  ty: number;
  kind: PowerUpKind;
  revealedTick: number;
  revealGroup: number;
}

export type GameEvent =
  | { type: 'balloon_dropped'; slot: number; tx: number; ty: number }
  | { type: 'balloon_kicked'; balloonId: number; dir: Dir }
  | { type: 'balloon_burst'; balloonId: number; tx: number; ty: number; chainDepth: number }
  | { type: 'castle_washed'; tx: number; ty: number; byTide: boolean }
  | { type: 'powerup_revealed'; id: number; tx: number; ty: number; kind: PowerUpKind }
  | { type: 'powerup_collected'; slot: number; kind: PowerUpKind }
  | { type: 'powerup_destroyed'; id: number; tx: number; ty: number }
  | { type: 'player_soaked'; slot: number; bySlot: number; byTide: boolean; chainDepth: number }
  | { type: 'chain_burst'; depth: number; tx: number; ty: number }
  | { type: 'tide_advance'; ring: number }
  | { type: 'revenge_lob'; slot: number; tx: number; ty: number }
  | { type: 'round_end'; winnerSlot: number; draw: boolean }
  | { type: 'match_end'; winnerSlot: number }
  | { type: 'emote'; slot: number; emoteId: number };

export interface SimOptions {
  mode: GameMode;
  mapSeed: number;
  playerCount: number;
  roundsToWin: number;
  enableRevengeDucks: boolean;
}

export interface GameState {
  tick: number;
  phase: 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';
  w: number;
  h: number;
  tiles: number[];
  castleContents: Map<number, PowerUpKind>;
  exposedPowerUps: ExposedPowerUp[];
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  tideRing: number;
  roundNo: number;
  nextBalloonId: number;
  nextPowerUpId: number;
  nextBurstGroup: number;
  events: GameEvent[];
  roundEndTick: number;
  roundWinner: number;
  matchWinner: number;
  countdownUntilTick: number;
  roundStartTick: number;
  options: SimOptions;
  biggestChain: number;
}

export function tileIndex(w: number, x: number, y: number): number {
  return y * w + x;
}
