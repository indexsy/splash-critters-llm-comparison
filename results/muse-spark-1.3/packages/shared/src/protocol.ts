// Wire protocol — discriminated unions. JSON over WebSocket, REST for meta.
import type { AnimalId, GameMode, HatId, MapTheme } from './types.js';
import type { BotDifficulty } from './config.js';

export type ClientMsg =
  | { kind: 'hello'; token?: string }
  | { kind: 'set_nickname'; nickname: string }
  | { kind: 'queue_join'; mode: GameMode }
  | { kind: 'queue_leave' }
  | { kind: 'create_room'; name: string; maxPlayers: 2 | 4; isPublic: boolean; theme: MapTheme; roundsToWin: 2 | 3 | 5; botFill: boolean }
  | { kind: 'join_room'; code: string }
  | { kind: 'room_list_request'; mode?: 'all' | '2p' | '4p' }
  | { kind: 'leave_room' }
  | { kind: 'set_slot'; slot: number; botKind: 'empty' | 'bot' | 'closed'; difficulty?: BotDifficulty }
  | { kind: 'set_ready'; ready: boolean }
  | { kind: 'start_match' }
  | { kind: 'input'; seq: number; tick: number; dx: number; dy: number; balloon: boolean }
  | { kind: 'emote'; id: number }
  | { kind: 'rematch_vote'; yes: boolean }
  | { kind: 'set_cosmetics'; animal: AnimalId; hat: HatId }
  | { kind: 'pong'; t: number };

export type ServerMsg =
  | { kind: 'welcome'; playerId: string; token: string; nickname: string; tag: string; level: number; xp: number; animal: AnimalId; hat: HatId }
  | { kind: 'error'; code: string; msg: string }
  | { kind: 'queue_status'; mode: GameMode; elapsedS: number; searchRange: number; etaS: number }
  | { kind: 'match_found'; code: string }
  | { kind: 'room_created'; code: string }
  | { kind: 'room_list'; rooms: RoomSummary[] }
  | { kind: 'lobby_state'; room: RoomState }
  | { kind: 'match_start'; code: string; mode: GameMode; theme: MapTheme; roundsToWin: number }
  | { kind: 'round_start'; roundNo: number; mapSeed: number; theme: MapTheme; w: number; h: number; castles: number[][]; tideRing: number }
  | { kind: 'snapshot'; tick: number; players: SnapPlayer[]; balloons: SnapBalloon[]; splashes: { x: number; y: number; ttl: number }[]; powerups: { x: number; y: number; kind: string }[]; tideRing: number; serverTick: number }
  | { kind: 'event'; ev: string; a?: string; b?: string; tx?: number; ty?: number; ekind?: string; count?: number; text?: string; tick: number }
  | { kind: 'round_end'; roundNo: number; winner: string | string[] | null; scores: { id: string; roundsWon: number }[] }
  | { kind: 'match_end'; placements: Placement[]; ratingDeltas?: Record<string, number>; xp: Record<string, number> }
  | { kind: 'ping'; t: number }
  | { kind: 'profile'; profile: unknown }
  | { kind: 'emote_broadcast'; from: string; id: number };

export interface RoomSummary {
  code: string;
  name: string;
  mode: string;
  players: number;
  maxPlayers: number;
  theme: string;
  host: string;
}

export interface RoomState {
  code: string;
  name: string;
  maxPlayers: number;
  isPublic: boolean;
  theme: MapTheme;
  roundsToWin: number;
  slots: SlotState[];
  status: 'lobby' | 'playing';
  hostId: string;
}

export interface SlotState {
  slot: number;
  kind: 'human' | 'bot' | 'empty';
  playerId?: string;
  nickname?: string;
  difficulty?: BotDifficulty;
  ready?: boolean;
  animal?: AnimalId;
  hat?: HatId;
}

export interface SnapPlayer {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  isDuck: boolean;
  speed: number;
  balloons: number;
  range: number;
  boots: boolean;
  roundsWon: number;
  animal: AnimalId;
  hat: HatId;
  nick: string;
}

export interface SnapBalloon {
  id: number;
  x: number;
  y: number;
  fuse: number;
  range: number;
  owner: string;
}

export interface Placement {
  playerId: string;
  nickname: string;
  placement: number;
  soaks: number;
  roundsWon: number;
  ratingBefore?: number;
  ratingAfter?: number;
  xpEarned?: number;
}
