import type { BotDifficulty, EmoteId, GameMode, MapTheme, InputTick, PowerupType } from './types'
import type { SimEvent } from './types'

export interface PlayerProfile {
  id: string
  nickname: string
  tag: string
  xp: number
  level: number
  animal: string
  hat: string
  ratings: Record<string, { rating: number; games: number; wins: number; peak: number }>
}

export interface LobbyPlayer {
  slot: number
  kind: 'human' | 'bot' | 'empty'
  playerId?: string
  nickname?: string
  animal?: string
  hat?: string
  level?: number
  ready?: boolean
  difficulty?: BotDifficulty
  rating?: number
  tier?: string
}

export interface RoomInfo {
  id: string
  code: string
  name: string
  mode: GameMode
  size: number
  playerCount: number
  public: boolean
  theme: MapTheme | 'random'
  roundsToWin: number
  botFill: boolean
  hostSlot: number
  inMatch: boolean
}

export interface CreateRoomOpts {
  name?: string
  size: 2 | 4
  public: boolean
  theme: MapTheme | 'random'
  roundsToWin: 2 | 3 | 5
  botFill: boolean
}

export interface MatchPlayerIntro {
  playerId: string
  slot: number
  nickname: string
  animal: string
  hat: string
  rating?: number
  tier?: string
  isBot: boolean
}

export interface Snapshot {
  t: number
  tick: number
  players: Array<{
    id: number
    x: number
    y: number
    facing: string
    alive: boolean
    animal: string
    hat: string
    nickname: string
    stats: [number, number, number, 0 | 1]
    roundsWon: number
    soaks: number
  }>
  balloons: Array<{ id: number; x: number; y: number; fuse: number; fuseMax: number; owner: number; slide: string | null }>
  splashes: Array<{ id: number; born: number; until: number; cells: number[]; owner: number }>
  powerups: Array<{ x: number; y: number; type: PowerupType }>
  tide: number
  ducks: Array<{ playerId: number; x: number; y: number }>
}

export type C2S =
  | { t: 'hello'; token?: string; tutorialComplete?: boolean }
  | { t: 'set_nickname'; nickname: string }
  | { t: 'set_cosmetics'; animal: string; hat: string }
  | { t: 'queue_join'; mode: GameMode }
  | { t: 'queue_leave' }
  | { t: 'create_room'; opts: CreateRoomOpts }
  | { t: 'join_room'; code: string }
  | { t: 'room_list_request' }
  | { t: 'leave_room' }
  | { t: 'set_slot'; slot: number; kind: 'bot' | 'empty'; difficulty: BotDifficulty }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'start_match' }
  | { t: 'input'; seq: number; tick: number; dir: InputTick['dir']; balloon: boolean }
  | { t: 'emote'; id: EmoteId }
  | { t: 'rematch_vote' }
  | { t: 'pong'; at: number }

export type S2C =
  | { t: 'welcome'; playerId: string; profile: PlayerProfile; token: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'queue_status'; mode: GameMode; eta: number; searchRange: number; playersWaiting: number }
  | { t: 'match_found'; roomId: string }
  | { t: 'room_created'; room: RoomInfo }
  | { t: 'room_list'; rooms: RoomInfo[] }
  | { t: 'lobby_state'; room: RoomInfo; players: LobbyPlayer[] }
  | { t: 'match_start'; config: { players: MatchPlayerIntro[]; theme: MapTheme; roundsToWin: number; ranked: boolean; mode: GameMode } }
  | { t: 'round_start'; roundNo: number; mapSeed: number; W: number; H: number; castleGridB64: string; spawns: Array<[number, number]>; theme: MapTheme }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'events'; tick: number; events: SimEvent[] }
  | { t: 'round_end'; roundNo: number; winnerIds: number[]; draw: boolean; scores: Array<{ id: number; roundsWon: number; soaks: number }> }
  | { t: 'match_end'; placements: Array<{ id: number; nickname: string; placement: number; roundsWon: number; soaks: number; castlesWashed: number; isBot: boolean; award?: string }>; funChain?: number; xp: { gained: number; total: number; leveledUp: boolean }; rating?: { before: number; after: number; delta: number; tier: string; peak: number }; matchId?: string }
  | { t: 'ping'; at: number }
  | { t: 'emote_b'; playerId: number; id: EmoteId }
  | { t: 'host_left' }
  | { t: 'round_cancel'; reason: string }
  | { t: 'ticker'; msg: string }

export type WireMsg = C2S | S2C
