/**
 * Client app store — plain reactive state + settings persistence.
 * Screens subscribe(); net.ts mutates and calls notify().
 */

import type {
  LeaderboardEntry,
  LobbyState,
  MapTheme,
  MatchConfig,
  MatchResult,
  Mode,
  ProfileDTO,
  RoomListItem,
} from '@splash/shared';

export type ScreenName =
  | 'boot'
  | 'title'
  | 'tutorial'
  | 'menu'
  | 'browser'
  | 'lobby'
  | 'queue'
  | 'game'
  | 'results'
  | 'leaderboard'
  | 'locker'
  | 'settings'
  | 'howto';

export type BindAction = 'up' | 'down' | 'left' | 'right' | 'balloon';

export interface Settings {
  sfx: number; // 0..1
  music: number; // 0..1
  muted: boolean;
  reduceShake: boolean;
  colorblind: boolean;
  binds: Record<BindAction, string[]>;
}

const DEFAULT_BINDS: Record<BindAction, string[]> = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  balloon: ['Space', 'KeyE'],
};

function loadSettings(): Settings {
  const base: Settings = {
    sfx: 0.7,
    music: 0.4,
    muted: false,
    reduceShake: false,
    colorblind: false,
    binds: JSON.parse(JSON.stringify(DEFAULT_BINDS)),
  };
  try {
    const raw = localStorage.getItem('splash.settings');
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      Object.assign(base, s);
      base.binds = { ...DEFAULT_BINDS, ...(s.binds ?? {}) };
    }
  } catch {
    /* ignore corrupt settings */
  }
  return base;
}

export interface QueueInfo {
  mode: Mode;
  elapsed: number;
  searchRange: number;
  size: number;
}

export class Store {
  screen: ScreenName = 'boot';
  connected = false;
  profile: ProfileDTO | null = null;
  token: string | null = null;
  ping = 0;

  roomList: RoomListItem[] = [];
  lobby: LobbyState | null = null;
  queue: QueueInfo | null = null;

  matchConfig: MatchConfig | null = null;
  matchTheme: MapTheme = 'backyard';
  result: MatchResult | null = null;
  lastXp: { xp: number; level: number; leveledUp: boolean; unlocked: string[] } | null = null;

  leaderboard: { mode: Mode; entries: LeaderboardEntry[] } | null = null;
  tutorialSeen = false;

  settings: Settings = loadSettings();

  private listeners = new Set<() => void>();

  constructor() {
    this.token = localStorage.getItem('splash.token');
    this.tutorialSeen = localStorage.getItem('splash.tutorial') === '1';
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  notify(): void {
    for (const cb of this.listeners) cb();
  }

  saveSettings(): void {
    localStorage.setItem('splash.settings', JSON.stringify(this.settings));
    this.notify();
  }

  saveToken(token: string): void {
    this.token = token;
    localStorage.setItem('splash.token', token);
  }

  markTutorialSeen(): void {
    this.tutorialSeen = true;
    localStorage.setItem('splash.tutorial', '1');
  }

  actionForCode(code: string): BindAction | null {
    for (const action of Object.keys(this.settings.binds) as BindAction[]) {
      if (this.settings.binds[action].includes(code)) return action;
    }
    return null;
  }
}

export const store = new Store();
