import {
  AnimalId,
  BotDifficulty,
  Dir,
  ExposedPowerUp,
  GameEvent,
  GameMode,
  HatId,
  ThemeId,
} from './types.js';

export interface RoomOptions {
  name: string;
  size: 2 | 4;
  isPublic: boolean;
  theme: ThemeId | 'random';
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  size: 2 | 4;
  players: number;
  maxPlayers: number;
  theme: ThemeId;
  host: string;
}

export interface LobbySlot {
  slot: number;
  kind: 'human' | 'bot' | 'open';
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  botDifficulty: BotDifficulty | null;
  ready: boolean;
  isHost: boolean;
  playerId: string | null;
}

export interface LobbyState {
  code: string;
  name: string;
  size: 2 | 4;
  isPublic: boolean;
  theme: ThemeId;
  roundsToWin: number;
  botFill: boolean;
  ranked: boolean;
  mode: GameMode;
  slots: LobbySlot[];
}

export interface SnapshotPlayer {
  slot: number;
  x: number;
  y: number;
  alive: boolean;
  dir: Dir;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  isDuck: boolean;
  duckPos: number;
  lastInputSeq: number;
  emoteId: number;
  emoteUntilTick: number;
}

export interface SnapshotBalloon {
  id: number;
  ownerSlot: number;
  tx: number;
  ty: number;
  fx: number;
  fy: number;
  slideDir: Dir;
  burstTick: number;
  range: number;
  flying: boolean;
}

export interface SnapshotSplash {
  tiles: number[];
  untilTick: number;
}

export interface Snapshot {
  tick: number;
  phase: 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';
  roundNo: number;
  tideRing: number;
  countdownUntilTick: number;
  roundWinner: number;
  matchWinner: number;
  players: SnapshotPlayer[];
  balloons: SnapshotBalloon[];
  splashes: SnapshotSplash[];
  powerups: ExposedPowerUp[];
  destroyedCastles: number[];
}

export interface MatchPlayerConfig {
  slot: number;
  playerId: string;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  rating: number | null;
}

export interface Placement {
  slot: number;
  playerId: string;
  nickname: string;
  tag: string;
  animal: AnimalId;
  placement: number;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  isBot: boolean;
}

export type ClientMessage =
  | { t: 'hello'; token?: string }
  | { t: 'set_nickname'; nickname: string }
  | { t: 'queue_join'; mode: GameMode }
  | { t: 'queue_leave' }
  | { t: 'create_room'; opts: RoomOptions }
  | { t: 'join_room'; code: string }
  | { t: 'room_list_request' }
  | { t: 'leave_room' }
  | { t: 'set_slot'; slot: number; kind: 'bot' | 'open'; difficulty?: BotDifficulty }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'start_match' }
  | { t: 'input'; seq: number; dir: Dir; balloon: boolean }
  | { t: 'emote'; id: number }
  | { t: 'rematch_vote' }
  | { t: 'set_cosmetics'; animal: AnimalId; hat: HatId }
  | { t: 'tutorial_complete' }
  | { t: 'pong'; t0: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: string; token: string; profile: ProfileDto }
  | { t: 'error'; code: string; msg: string }
  | { t: 'profile'; profile: ProfileDto }
  | { t: 'queue_status'; mode: GameMode; eta: number; searchRange: number; inQueue: number }
  | { t: 'match_found'; mode: GameMode; ranked: boolean }
  | { t: 'room_created'; code: string }
  | { t: 'room_list'; rooms: RoomSummary[] }
  | { t: 'lobby_state'; lobby: LobbyState }
  | { t: 'match_start'; config: MatchConfigDto }
  | { t: 'round_start'; roundNo: number; mapSeed: number; castleGrid: number[]; theme: ThemeId }
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'event'; events: GameEvent[] }
  | { t: 'round_end'; roundNo: number; winnerSlot: number; draw: boolean; wins: number[] }
  | { t: 'match_end'; placements: Placement[]; xp: Record<string, number>; ratingDeltas: Record<string, number>; rematch: boolean }
  | { t: 'rematch_status'; votes: number; needed: number }
  | { t: 'ping'; t0: number };

export interface ProfileDto {
  playerId: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  tutorialDone: boolean;
  customNickname: boolean;
  ratings: { mode: GameMode; rating: number; games: number; wins: number; peak: number }[];
  unlocks: string[];
}

export interface MatchConfigDto {
  mode: GameMode;
  ranked: boolean;
  theme: ThemeId;
  roundsToWin: number;
  enableRevengeDucks: boolean;
  players: MatchPlayerConfig[];
}
