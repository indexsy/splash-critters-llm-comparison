import type { AnimalId, Difficulty, HatId, Mode, PowerupKind, Theme, ThemePick } from './config.js';
import type { SimEvent } from './types.js';

export interface RatingView {
  rating: number;
  games: number;
  wins: number;
  peak: number;
  tier: string;
  tierId?: string;
  next?: number | null;
}

export interface RecentMatch {
  id: string;
  mode: Mode;
  ranked: boolean;
  endedAt: number;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xp: number;
}

export interface Profile {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  animal: AnimalId;
  hat: HatId | null;
  tutorialDone: boolean;
  nickSet: boolean;
  ratings: { duel: RatingView; ffa: RatingView };
  unlocks: string[];
  recent: RecentMatch[];
}

export interface RoomOpts {
  name: string;
  mode: Mode;
  public: boolean;
  theme: ThemePick;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: Mode;
  players: number;
  max: number;
  theme: ThemePick;
  host: string;
  public: boolean;
}

export interface LobbySlot {
  index: number;
  kind: 'human' | 'bot' | 'open';
  playerId?: string;
  name?: string;
  animal?: AnimalId;
  hat?: HatId | null;
  difficulty?: Difficulty;
  ready?: boolean;
  host?: boolean;
  connected?: boolean;
}

export interface LobbyState {
  code: string;
  name: string;
  mode: Mode;
  public: boolean;
  theme: ThemePick;
  roundsToWin: number;
  botFill: boolean;
  hostId: string;
  ranked: boolean;
  phase: 'lobby' | 'intro' | 'playing' | 'round_end' | 'results';
  slots: LobbySlot[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  animal: AnimalId;
  hat: HatId | null;
  slot: number;
  rating?: number;
  tier?: string;
  isBot: boolean;
  difficulty?: Difficulty | null;
}

export interface SnapshotPlayer {
  id: string;
  x: number;
  y: number;
  facing: number;
  alive: boolean;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasKick: boolean;
  flippers: number;
  roundWins: number;
  soaks: number;
  revengeSoaks: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
  longestLife: number;
  ducking: boolean;
  duckT: number;
  duckCooldown: number;
  animal: AnimalId;
  hat: HatId | null;
  name: string;
  isBot: boolean;
  ping?: number;
}

export interface SnapshotBalloon {
  id: string;
  x: number;
  y: number;
  fuse: number;
  ownerId: string;
  range: number;
  sliding: boolean;
  slideDir: number;
  slideAcc: number;
  revenge: boolean;
}

export interface PlacementRow {
  playerId: string;
  name: string;
  animal: AnimalId;
  hat: HatId | null;
  placement: number;
  soaks: number;
  revengeSoaks: number;
  castles: number;
  roundsWon: number;
  survivedTicks: number;
  longestLife: number;
  biggestChain: number;
  xp: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  tierBefore: string | null;
  tierAfter: string | null;
  isBot: boolean;
}

export type ClientMsg =
  | { t: 'hello'; token?: string }
  | { t: 'set_nickname'; nickname: string }
  | { t: 'queue_join'; mode: Mode }
  | { t: 'queue_leave' }
  | { t: 'create_room'; opts: RoomOpts }
  | { t: 'join_room'; code: string }
  | { t: 'room_list_request'; mode?: Mode | 'all' }
  | { t: 'leave_room' }
  | { t: 'set_slot'; slot: number; kind: 'open' | 'bot'; difficulty?: Difficulty }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'start_match' }
  | { t: 'input'; seq: number; tick: number; dir: number; balloon: boolean }
  | { t: 'emote'; id: number }
  | { t: 'rematch_vote'; yes: boolean }
  | { t: 'pong'; serverTime: number; clientTime: number }
  | { t: 'set_cosmetic'; animal?: AnimalId; hat?: HatId | null }
  | { t: 'tutorial_complete'; skipped?: boolean }
  | { t: 'delete_account' };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; profile: Profile; token: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'queue_status'; eta: number; searchRange: number; elapsed: number; mode: Mode }
  | { t: 'match_found'; matchId: string; mode: Mode; players: PublicPlayer[] }
  | { t: 'room_created'; code: string; room: LobbyState }
  | { t: 'room_list'; rooms: RoomSummary[] }
  | { t: 'lobby_state'; room: LobbyState }
  | { t: 'match_start'; matchId: string; mode: Mode; ranked: boolean; theme: Theme; roundsToWin: number; players: PublicPlayer[]; you: string }
  | { t: 'round_start'; roundNo: number; mapSeed: number; castleGrid: string; theme: Theme; width: number; height: number; spawns: { x: number; y: number; id: string }[] }
  | { t: 'snapshot'; tick: number; serverTime: number; acks: Record<string, number>; players: SnapshotPlayer[]; balloons: SnapshotBalloon[]; splashes: { x: number; y: number; ttl: number; ownerId: string; chain: number }[]; powerups: { x: number; y: number; kind: PowerupKind }[]; tideRing: number; warmup: number; phase: 'playing' | 'round_end'; winnerId: string | null; draw: boolean; roundNo: number }
  | { t: 'event'; event: SimEvent }
  | { t: 'round_end'; roundNo: number; winnerId: string | null; draw: boolean; scores: { id: string; name: string; roundWins: number }[] }
  | { t: 'match_end'; matchId: string; mode: Mode; ranked: boolean; placements: PlacementRow[]; fun: { mostSoaks: string; castleCrusher: string; longestSurvivor: string; biggestChain: string }; rematch: boolean }
  | { t: 'ping'; serverTime: number; rtt: number }
  | { t: 'emote'; playerId: string; id: number }
  | { t: 'profile'; profile: Profile }
  | { t: 'rematch_update'; yes: number; need: number; voters: string[] }
  | { t: 'kicked'; reason: string };

export type SnapshotMsg = Extract<ServerMsg, { t: 'snapshot' }>;
export type MatchStartMsg = Extract<ServerMsg, { t: 'match_start' }>;
export type RoundStartMsg = Extract<ServerMsg, { t: 'round_start' }>;
