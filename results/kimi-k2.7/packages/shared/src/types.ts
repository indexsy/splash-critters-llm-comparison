import type { Animal, Difficulty, Hat, Mode, SlotKind, Theme } from "./config.js";

export type Vec2 = { x: number; y: number };
export type TileCoord = { tx: number; ty: number };

export type InputState = {
  seq: number;
  tick: number;
  dir: Vec2;
  balloonPressed: boolean;
  kickPressed: boolean;
};

export type PlayerStats = {
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
};

export type Player = {
  id: string;
  playerId?: string; // account id
  nickname: string;
  animal: Animal;
  hat: Hat;
  slot: number;
  alive: boolean;
  pos: Vec2;
  dir: Vec2;
  stats: PlayerStats;
  activeBalloons: number;
  emoteUntilTick: number;
  emoteId: number;
  revengeDuck: boolean;
  revengeCooldownTick: number;
  botDifficulty?: Difficulty;
  input?: InputState;
};

export type Balloon = {
  id: string;
  ownerId: string;
  tx: number;
  ty: number;
  fuseTick: number;
  range: number;
  sliding?: {
    dir: Vec2;
    distRemaining: number;
    nextMoveTick: number;
  };
};

export type Splash = {
  id: string;
  tx: number;
  ty: number;
  ownerId: string;
  lingerTick: number;
};

export type PowerUp = {
  id: string;
  tx: number;
  ty: number;
  type: PowerUpType;
};

export type PowerUpType = "extraBalloon" | "bigSplash" | "flippers" | "rubberBoots";

export type CastleCell = {
  hasCastle: boolean;
  powerUp?: PowerUpType;
};

export type RoundState = {
  roundNo: number;
  tick: number;
  mapSeed: number;
  theme: Theme;
  width: number;
  height: number;
  castles: (CastleCell | null)[][];
  tideRing: number; // -1 = none, 0 = outer ring, etc.
  players: Player[];
  balloons: Balloon[];
  splashes: Splash[];
  powerUps: PowerUp[];
  events: GameEvent[];
  ended: boolean;
  winnerId: string | null;
  draw: boolean;
};

export type MatchState = {
  id: string;
  mode: Mode;
  ranked: boolean;
  theme: Theme;
  roundWins: Record<string, number>;
  roundNo: number;
  round?: RoundState;
  players: { id: string; nickname: string; animal: Animal; hat: Hat; playerId?: string; rating?: number }[];
  startedAt: number;
  ended: boolean;
  placements?: string[];
};

export type GameEvent =
  | { type: "castle_washed"; tx: number; ty: number }
  | { type: "powerup_revealed"; tx: number; ty: number; powerUp: PowerUpType }
  | { type: "powerup_collected"; playerId: string; tx: number; ty: number; powerUp: PowerUpType }
  | { type: "player_soaked"; playerId: string; byPlayerId?: string; revenge?: boolean }
  | { type: "chain_burst"; count: number }
  | { type: "balloon_kicked"; balloonId: string; tx: number; ty: number }
  | { type: "tide_advance"; ring: number }
  | { type: "revenge_lob"; playerId: string };

export type SimInput = {
  playerId: string;
  tick: number;
  dir: Vec2;
  balloonPressed: boolean;
  kickPressed: boolean;
};

export type Snapshot = {
  tick: number;
  players: {
    id: string;
    pos: Vec2;
    dir: Vec2;
    alive: boolean;
    activeBalloons: number;
    stats: PlayerStats;
    emoteUntilTick: number;
    emoteId: number;
    revengeDuck: boolean;
    revengeCooldownTick: number;
  }[];
  balloons: Balloon[];
  splashes: Splash[];
  powerUps: PowerUp[];
  tideRing: number;
  events: GameEvent[];
};

export type RoomOpts = {
  name: string;
  mode: "duel" | "ffa";
  public: boolean;
  theme: Theme | "random";
  roundsToWin: number;
  botFill: boolean;
};

export type LobbySlot = {
  slot: number;
  kind: SlotKind;
  difficulty?: Difficulty;
  playerId?: string;
  nickname?: string;
  animal?: Animal;
  hat?: Hat;
  ready: boolean;
};

export type RoomInfo = {
  code: string;
  name: string;
  mode: "duel" | "ffa";
  public: boolean;
  theme: Theme | "random";
  players: number;
  maxPlayers: number;
  host: string;
};

export type Profile = {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: Animal;
  selectedHat: Hat;
  ratings: { mode: Mode; rating: number; games: number; wins: number; peak: number }[];
  unlocks: string[];
};

export type LeaderboardEntry = {
  rank: number;
  nickname: string;
  tag: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
};

export type MatchResult = {
  matchId: string;
  mode: Mode;
  ranked: boolean;
  placements: { playerId: string; placement: number }[];
  ratingDeltas: Record<string, number>;
  xp: Record<string, number>;
  stats: Record<string, { soaks: number; castles: number; roundsWon: number }>;
};
