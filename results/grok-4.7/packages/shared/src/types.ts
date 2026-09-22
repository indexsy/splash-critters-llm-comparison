import type { BotDiff, Dir, Mode, PowerKind, Theme } from './config.js';

export interface ProfileRating {
  mode: Mode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
  tier: string;
}

export interface Profile {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  animal: string;
  hat: string;
  tutorialDone: boolean;
  nicknameSet: boolean;
  ratings: ProfileRating[];
  unlocks: string[];
}

export interface RoomOpts {
  name: string;
  mode: Mode;
  public: boolean;
  theme: Theme | 'random';
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export interface LobbySlot {
  index: number;
  kind: 'open' | 'human' | 'bot';
  playerId?: string;
  name?: string;
  tag?: string;
  animal?: string;
  hat?: string;
  ready?: boolean;
  difficulty?: BotDiff;
  ping?: number;
  connected?: boolean;
  host?: boolean;
}

export interface LobbyState {
  code: string;
  name: string;
  mode: Mode;
  public: boolean;
  theme: Theme | 'random';
  roundsToWin: number;
  botFill: boolean;
  hostId: string;
  phase: 'lobby' | 'playing' | 'results';
  slots: LobbySlot[];
  rematchYes?: number;
  rematchNeed?: number;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: Mode;
  players: number;
  max: number;
  theme: Theme | 'random';
  host: string;
}

export interface PlayerCard {
  id: string;
  name: string;
  tag: string;
  animal: string;
  hat: string;
  rating: number;
  tier: string;
  bot: boolean;
  difficulty?: BotDiff;
}

export interface FunStat {
  id: string;
  name: string;
  value: number;
}

export interface PlacementRow {
  id: string;
  name: string;
  tag: string;
  animal: string;
  hat: string;
  placement: number;
  roundWins: number;
  soaks: number;
  castles: number;
  bot: boolean;
}

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
  tierBefore: string;
  tierAfter: string;
}

export type { Dir, Mode, Theme, BotDiff, PowerKind };
