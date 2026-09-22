import type { Dir, Mode, PowerKind, Theme } from './config.js';
import type {
  FunStat,
  LobbyState,
  PlacementRow,
  PlayerCard,
  Profile,
  RatingChange,
  RoomOpts,
  RoomSummary,
} from './types.js';

export interface NetPlayer {
  id: string;
  name: string;
  animal: string;
  hat: string;
  x: number;
  y: number;
  dir: Dir;
  alive: boolean;
  ducking: boolean;
  duckPos: number;
  speed: number;
  balloonMax: number;
  splashRange: number;
  hasKick: boolean;
  flippers: number;
  soaks: number;
  castles: number;
  roundWins: number;
  balloonHeld: boolean;
  phasingX: number;
  phasingY: number;
  ping: number;
  soakedBy: string | null;
}

export interface NetBalloon {
  id: number;
  ownerId: string;
  tx: number;
  ty: number;
  fuse: number;
  range: number;
  slideDir: Dir | null;
  slideProg: number;
  slideTiles: number;
  maxSlide: number;
  revenge: boolean;
}

export interface NetSplash {
  x: number;
  y: number;
  dir: Dir | 'center';
  ttl: number;
  ownerId: string;
}

export interface NetPower {
  x: number;
  y: number;
  kind: PowerKind;
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  ackSeq: number;
  tide: number;
  phase: 'playing' | 'round_end';
  winnerId: string | null;
  draw: boolean;
  width: number;
  height: number;
  players: NetPlayer[];
  balloons: NetBalloon[];
  splashes: NetSplash[];
  powerups: NetPower[];
  castles: number[];
  round: number;
  timeLeft: number;
}

export type ClientMsg =
  | { t: 'hello'; token?: string }
  | { t: 'set_nickname'; nickname: string }
  | { t: 'queue_join'; mode: Mode }
  | { t: 'queue_leave' }
  | { t: 'create_room'; opts: RoomOpts }
  | { t: 'join_room'; code: string }
  | { t: 'room_list_request'; mode?: Mode | 'any' }
  | { t: 'leave_room' }
  | { t: 'set_slot'; slot: number; kind: 'open' | 'bot'; difficulty?: 'easy' | 'medium' | 'hard' }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'start_match' }
  | { t: 'input'; seq: number; tick: number; dir: Dir; balloonPressed: boolean }
  | { t: 'emote'; id: number }
  | { t: 'rematch_vote'; yes: boolean }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'tutorial_begin' }
  | { t: 'tutorial_skip' }
  | { t: 'practice_start' }
  | { t: 'select_cosmetic'; animal?: string; hat?: string };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; profile: Profile; token: string }
  | { t: 'profile'; profile: Profile }
  | { t: 'error'; code: string; msg: string }
  | { t: 'queue_status'; eta: number; searchRange: number; elapsed: number; mode: Mode }
  | { t: 'match_found'; mode: Mode; ranked: boolean }
  | { t: 'room_created'; code: string }
  | { t: 'room_list'; rooms: RoomSummary[] }
  | { t: 'lobby_state'; room: LobbyState }
  | {
      t: 'match_start';
      matchId: string;
      mode: Mode;
      ranked: boolean;
      kind: 'ranked' | 'casual' | 'tutorial' | 'practice';
      theme: Theme;
      roundsToWin: number;
      players: PlayerCard[];
    }
  | {
      t: 'round_start';
      roundNo: number;
      mapSeed: number;
      width: number;
      height: number;
      castleGrid: number[];
      theme: Theme;
      spawns: { x: number; y: number }[];
      serverTime: number;
      goAt: number;
      revenge: boolean;
    }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'event'; event: import('./sim.js').SimEvent }
  | {
      t: 'round_end';
      roundNo: number;
      winnerId: string | null;
      draw: boolean;
      scores: { id: string; wins: number; name: string }[];
    }
  | {
      t: 'match_end';
      placements: PlacementRow[];
      ratingDeltas: Record<string, RatingChange>;
      xp: Record<string, number>;
      stats: {
        mostSoaks: FunStat | null;
        castleCrusher: FunStat | null;
        longestSurvivor: FunStat | null;
        biggestChain: FunStat | null;
      };
      ranked: boolean;
      casual: boolean;
    }
  | { t: 'ping'; serverTime: number; rtt: number }
  | { t: 'emote'; playerId: string; id: number }
  | { t: 'rematch_status'; yes: number; need: number };

export type { SimEvent } from './sim.js';
