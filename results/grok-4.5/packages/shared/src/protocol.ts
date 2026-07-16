import type { AnimalId, BotDifficulty, GameMode, HatId, MapTheme, MatchKind } from './config.js';
import type {
  Dir,
  ExposedPowerup,
  FunStats,
  GameEvent,
  MatchConfig,
  Placement,
  Profile,
  RoomInfo,
  RoomOptions,
  Splash,
} from './types.js';

// ── Client → Server ──
export type C2S =
  | { t: 'hello'; token?: string }
  | { t: 'set_nickname'; nickname: string }
  | { t: 'set_cosmetic'; animal: AnimalId; hat: HatId }
  | { t: 'queue_join'; mode: GameMode }
  | { t: 'queue_leave' }
  | { t: 'create_room'; opts: RoomOptions }
  | { t: 'join_room'; code: string }
  | { t: 'room_list_request' }
  | { t: 'leave_room' }
  | { t: 'set_slot'; slot: number; kind: 'empty' | 'bot' | 'human'; difficulty?: BotDifficulty }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'start_match' }
  | { t: 'input'; seq: number; tick: number; dir: Dir; balloonPressed: boolean }
  | { t: 'emote'; id: number }
  | { t: 'rematch_vote'; yes: boolean }
  | { t: 'pong'; time: number }
  | { t: 'practice'; size: 2 | 4; difficulty: BotDifficulty }
  | { t: 'tutorial_start' }
  | { t: 'tutorial_complete' };

// ── Server → Client ──
export type SnapshotPlayer = {
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
  alive: boolean;
  isBot: boolean;
  animal: AnimalId;
  hat: HatId;
  nickname: string;
  revenge: boolean;
  soaks: number;
  inputSeq: number;
};

export type SnapshotBalloon = {
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

export type Snapshot = {
  tick: number;
  players: SnapshotPlayer[];
  balloons: SnapshotBalloon[];
  splashes: Splash[];
  powerups: ExposedPowerup[];
  tideRing: number;
  livingCount: number;
};

export type LobbySlot = {
  slot: number;
  kind: 'empty' | 'human' | 'bot';
  playerId?: string;
  nickname?: string;
  animal?: AnimalId;
  hat?: HatId;
  difficulty?: BotDifficulty;
  ready?: boolean;
  connected?: boolean;
  isHost?: boolean;
};

export type S2C =
  | { t: 'welcome'; playerId: string; profile: Profile; token: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'profile_update'; profile: Profile }
  | { t: 'queue_status'; mode: GameMode; elapsed: number; searchRange: number; eta: number }
  | { t: 'match_found'; config: MatchConfig }
  | { t: 'room_created'; code: string }
  | { t: 'room_list'; rooms: RoomInfo[] }
  | { t: 'lobby_state'; code: string; opts: RoomOptions; slots: LobbySlot[]; hostId: string }
  | { t: 'match_start'; config: MatchConfig }
  | {
      t: 'round_start';
      roundNo: number;
      mapSeed: number;
      castleGrid: number[];
      theme: MapTheme;
      width: number;
      height: number;
      scores: Record<string, number>;
    }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'event'; events: GameEvent[] }
  | {
      t: 'round_end';
      roundNo: number;
      winnerIds: string[];
      draw: boolean;
      scores: Record<string, number>;
      soaks: Record<string, number>;
    }
  | {
      t: 'match_end';
      placements: Placement[];
      funStats: FunStats;
      ratingDeltas?: Record<string, number>;
      xp: Record<string, number>;
      rematchEligible: boolean;
    }
  | { t: 'ping'; time: number }
  | { t: 'emote'; playerId: string; id: number }
  | { t: 'rematch_status'; votes: Record<string, boolean> }
  | { t: 'countdown'; value: number | string };

export type AnyMessage = C2S | S2C;
