export type Mode = "duel" | "ffa";
export type Theme = "backyard" | "beach" | "pool";
export type Difficulty = "easy" | "medium" | "hard";
export type Animal = "frog" | "duck" | "otter" | "penguin" | "cat" | "raccoon" | "turtle" | "capybara";
export type Hat = "none" | "bucket" | "snorkel" | "crown" | "bandana" | "propeller";
export type PowerupKind = "balloon" | "range" | "flippers" | "boots";
export type Direction = "up" | "down" | "left" | "right" | "none";
export type Tile = 0 | 1 | 2;

export interface Point { x: number; y: number }
export interface PlayerStats { speed: number; balloonCount: number; splashRange: number; canKick: boolean }

export interface SimPlayer {
  id: string;
  name: string;
  animal: Animal;
  hat: Hat;
  x: number;
  y: number;
  alive: boolean;
  stats: PlayerStats;
  activeBalloons: number;
  roundsWon: number;
  soaks: number;
  castlesWashed: number;
  lastSeq: number;
  facing: Direction;
  moving: boolean;
  revengeReadyAt: number;
}

export interface Balloon {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  placedAt: number;
  burstAt: number;
  range: number;
  sliding: Direction;
  nextSlideAt: number;
  ownerMayPass: boolean;
  revenge?: boolean;
}

export interface Splash { x: number; y: number; ownerId: string; expiresAt: number; chain: number }
export interface ExposedPowerup { id: number; x: number; y: number; kind: PowerupKind }

export interface ArenaMap {
  width: number;
  height: number;
  seed: number;
  tiles: Tile[][];
  hiddenPowerups: Record<string, PowerupKind>;
  spawns: Point[];
}

export interface GameState {
  tick: number;
  roundStartedAt: number;
  mode: Mode;
  ranked: boolean;
  map: ArenaMap;
  players: SimPlayer[];
  balloons: Balloon[];
  splashes: Splash[];
  powerups: ExposedPowerup[];
  tideRing: number;
  nextEntityId: number;
  roundOver: boolean;
  winnerIds: string[];
}

export interface PlayerInput {
  playerId: string;
  seq: number;
  tick: number;
  dir: Direction;
  balloonPressed: boolean;
  revengePressed?: boolean;
}

export type SimEvent =
  | { type: "balloon_dropped"; balloon: Balloon }
  | { type: "castle_washed"; x: number; y: number; ownerId: string }
  | { type: "powerup_revealed"; powerup: ExposedPowerup }
  | { type: "powerup_collected"; playerId: string; kind: PowerupKind }
  | { type: "player_soaked"; playerId: string; ownerId: string }
  | { type: "chain_burst"; ownerId: string; chain: number; x: number; y: number }
  | { type: "balloon_kicked"; playerId: string; balloonId: number; dir: Direction }
  | { type: "tide_advance"; ring: number }
  | { type: "revenge_lob"; playerId: string; balloonId: number }
  | { type: "round_end"; winnerIds: string[] };

export interface SimResult { state: GameState; events: SimEvent[] }

export interface Profile {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: Animal;
  selectedHat: Hat;
  hasCustomNickname: boolean;
}

export interface RoomOptions {
  name: string;
  size: 2 | 4;
  visibility: "public" | "private";
  theme: Theme | "random";
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: Mode;
  players: number;
  maxPlayers: number;
  theme: Theme | "random";
  host: string;
}

export interface LobbySlot {
  index: number;
  kind: "empty" | "human" | "bot";
  playerId?: string;
  name?: string;
  animal?: Animal;
  ready?: boolean;
  difficulty?: Difficulty;
}

export interface LobbyView {
  code: string;
  opts: RoomOptions;
  hostId: string;
  slots: LobbySlot[];
  phase: "lobby" | "playing" | "results";
  rematchVotes: number;
}
