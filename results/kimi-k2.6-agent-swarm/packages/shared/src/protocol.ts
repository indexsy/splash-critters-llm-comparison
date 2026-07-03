import type {
  PlayerId,
  RoomCode,
  MatchId,
  Direction,
  GameMode,
  Animal,
  Hat,
  BotDifficulty,
  RoomVisibility,
  Tile,
  GameConfig,
  SimEvent,
  Snapshot,
  Profile,
  MatchResult,
  EmoteId,
  LobbyState,
  RoomInfo,
} from './types.js';

// ============================================================================
// Client → Server
// ============================================================================

export type ClientMsg =
  | { type: 'hello'; token?: string }
  | { type: 'set_nickname'; nickname: string }
  | { type: 'queue_join'; mode: 'duel' | 'ffa' }
  | { type: 'queue_leave' }
  | {
      type: 'create_room';
      opts: {
        name: string;
        mode: GameMode;
        visibility: RoomVisibility;
        theme: 'backyard' | 'beach' | 'pool' | 'random';
        roundsToWin: number;
        botFill: boolean;
      };
    }
  | { type: 'join_room'; code: RoomCode }
  | { type: 'room_list_request'; filter?: GameMode }
  | { type: 'leave_room' }
  | { type: 'set_slot'; slot: number; kind: 'human' | 'bot'; difficulty?: BotDifficulty }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_match' }
  | { type: 'input'; seq: number; tick: number; dir?: Direction; balloonPressed: boolean }
  | { type: 'emote'; id: EmoteId }
  | { type: 'rematch_vote'; vote: boolean }
  | { type: 'pong'; t: number };

// ============================================================================
// Server → Client
// ============================================================================

export type ServerMsg =
  | {
      type: 'welcome';
      playerId: PlayerId;
      profile: Profile;
      token: string;
    }
  | { type: 'error'; code: string; msg: string }
  | { type: 'queue_status'; eta: number; searchRange: number }
  | {
      type: 'match_found';
      matchId: MatchId;
      mode: GameMode;
      players: { playerId: PlayerId; nickname: string; animal: Animal; rating?: number }[];
    }
  | { type: 'room_created'; code: RoomCode; lobby: LobbyState }
  | { type: 'room_list'; rooms: RoomInfo[] }
  | { type: 'lobby_state'; lobby: LobbyState }
  | {
      type: 'match_start';
      config: GameConfig;
      players: { playerId: PlayerId; nickname: string; animal: Animal; hat: Hat }[];
    }
  | {
      type: 'round_start';
      roundNo: number;
      mapSeed: number;
      castleGrid: Tile[][];
      theme: string;
      spawnPoints: { x: number; y: number }[];
    }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'event'; event: SimEvent }
  | { type: 'round_end'; winner: PlayerId | null; roundNo: number; scores: Record<PlayerId, number> }
  | { type: 'match_end'; result: MatchResult }
  | { type: 'ping'; t: number };

// ============================================================================
// Helpers
// ============================================================================

export function encodeMsg(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeMsg(data: string): ClientMsg | ServerMsg | null {
  try {
    const parsed = JSON.parse(data) as ClientMsg | ServerMsg;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
