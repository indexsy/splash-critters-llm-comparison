export type GameMode = 'duel' | 'ffa'
export type MapTheme = 'backyard' | 'beach' | 'pool'
export type PowerupType = 'extra_balloon' | 'big_splash' | 'flippers' | 'boots'
export type BotDifficulty = 'easy' | 'medium' | 'hard'

export const TILE = { EMPTY: 0, BOULDER: 1, CASTLE: 2, FLOOD: 3 } as const
export type Tile = (typeof TILE)[keyof typeof TILE]

export type Dir = 'up' | 'down' | 'left' | 'right' | 'none'
export type ExcludableDir = Exclude<Dir, 'none'>
export const DIRS: Record<ExcludableDir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
}

export interface InputTick {
  seq: number
  dir: Dir
  balloon: boolean
}

export type EmoteId = 0 | 1 | 2 | 3

export type SlotKind = 'human' | 'bot' | 'empty'

export interface PlayerStats {
  speed: number
  balloonCount: number
  splashRange: number
  boots: boolean
}

export interface SimPlayer {
  id: number
  x: number
  y: number
  facing: Dir
  alive: boolean
  stats: PlayerStats
  activeBalloons: number
  roundsWon: number
  soaks: number
  castlesWashed: number
}

export interface Balloon {
  id: number
  tx: number
  ty: number
  ownerId: number
  fuse: number
  range: number
  chainDepth: number
  slide: ExcludableDir | null
  slideAcc: number
}

export interface Splash {
  id: number
  cells: number[]
  owner: number
  until: number
  born: number
}

export interface Duck {
  playerId: number
  stepInt: number
  frac: number
  cooldown: number
}

export interface SimState {
  tick: number
  W: number
  H: number
  grid: Uint8Array
  players: SimPlayer[]
  balloons: Balloon[]
  splashes: Splash[]
  powerups: Map<number, PowerupType>
  contents: Map<number, PowerupType>
  tideStartTick: number
  tideRing: number
  ducks: Duck[]
  ducksEnabled: boolean
  kickEnabled: boolean
  rngState: number
  nextId: number
  over: boolean
  winnerIds: number[]
  draw: boolean
}

export type SimEvent =
  | { t: 'castle_washed'; x: number; y: number; by: number }
  | { t: 'powerup_revealed'; x: number; y: number; type: PowerupType }
  | { t: 'powerup_collected'; playerId: number; type: PowerupType; x: number; y: number }
  | { t: 'player_soaked'; playerId: number; by: number }
  | { t: 'chain_burst'; x: number; y: number; depth: number; owner: number }
  | { t: 'balloon_kicked'; id: number; dir: ExcludableDir; x: number; y: number }
  | { t: 'tide_advance'; ring: number }
  | { t: 'revenge_lob'; playerId: number; x: number; y: number; dir: ExcludableDir }
  | { t: 'round_over'; winnerIds: number[]; draw: boolean }
