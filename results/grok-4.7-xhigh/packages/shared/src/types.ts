import type { AnimalId, Difficulty, HatId, Mode, PowerupKind, Theme } from './config.js';

export const Tile = {
  Empty: 0,
  Boulder: 1,
  Sandcastle: 2,
  Flood: 3,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export const Dir = {
  None: 0,
  Up: 1,
  Right: 2,
  Down: 3,
  Left: 4,
} as const;
export type Dir = 0 | 1 | 2 | 3 | 4;

export const DIR_VEC: Record<number, { x: number; y: number }> = {
  0: { x: 0, y: 0 },
  1: { x: 0, y: -1 },
  2: { x: 1, y: 0 },
  3: { x: 0, y: 1 },
  4: { x: -1, y: 0 },
};

export interface PlayerInput {
  seq: number;
  tick: number;
  dir: Dir;
  balloon: boolean;
}

export type InputMap = Record<string, PlayerInput>;

export interface Player {
  id: string;
  name: string;
  slot: number;
  animal: AnimalId;
  hat: HatId | null;
  x: number;
  y: number;
  facing: Dir;
  alive: boolean;
  speed: number;
  balloonCount: number;
  splashRange: number;
  flippers: number;
  hasKick: boolean;
  passBalloonId: string;
  roundWins: number;
  soaks: number;
  revengeSoaks: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
  longestLife: number;
  roundAliveTicks: number;
  isBot: boolean;
  difficulty: Difficulty | null;
  ducking: boolean;
  duckT: number;
  duckDir: number;
  duckCooldown: number;
  soakedBy: string;
}

export interface Balloon {
  id: string;
  x: number;
  y: number;
  ownerId: string;
  fuse: number;
  range: number;
  sliding: boolean;
  slideDir: Dir;
  slideAcc: number;
  born: number;
  revenge: boolean;
}

export interface Splash {
  x: number;
  y: number;
  ttl: number;
  ownerId: string;
  chain: number;
  revenge?: boolean;
}

export interface Powerup {
  x: number;
  y: number;
  kind: PowerupKind;
}

export type SimEvent =
  | { type: 'castle_washed'; x: number; y: number; by: string }
  | { type: 'powerup_revealed'; x: number; y: number; kind: PowerupKind }
  | { type: 'powerup_collected'; x: number; y: number; kind: PowerupKind; playerId: string }
  | { type: 'player_soaked'; playerId: string; by: string; revenge: boolean }
  | { type: 'chain_burst'; count: number; x: number; y: number; by: string }
  | { type: 'balloon_kicked'; id: string; dir: number; by: string }
  | { type: 'tide_advance'; ring: number }
  | { type: 'revenge_lob'; playerId: string; x: number; y: number }
  | { type: 'balloon_placed'; id: string; x: number; y: number; ownerId: string }
  | { type: 'round_over'; winnerId: string | null };

export interface GameState {
  tick: number;
  phase: 'playing' | 'round_end';
  mode: Mode;
  theme: Theme;
  width: number;
  height: number;
  tiles: number[];
  hidden: (PowerupKind | null)[];
  players: Player[];
  balloons: Balloon[];
  splashes: Splash[];
  powerups: Powerup[];
  tideRing: number;
  warmup: number;
  revenge: boolean;
  roundsToWin: number;
  winnerId: string | null;
  draw: boolean;
  over: boolean;
  events: SimEvent[];
}

export interface CreatePlayer {
  id: string;
  name: string;
  slot: number;
  animal: AnimalId;
  hat: HatId | null;
  isBot: boolean;
  difficulty?: Difficulty | null;
}

export function idx(w: number, x: number, y: number): number {
  return y * w + x;
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function edgeDist(x: number, y: number, w: number, h: number): number {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

export function displayName(nick: string, tag: string): string {
  return `${nick}#${tag}`;
}

export function opposite(dir: Dir): Dir {
  if (dir === 1) return 3;
  if (dir === 3) return 1;
  if (dir === 2) return 4;
  if (dir === 4) return 2;
  return 0;
}
