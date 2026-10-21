import type { AnimalId, HatId, Mode, PlayerProfile } from '@splash-critters/shared';

export type ScreenName =
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
  | 'help';

export interface Keybinds {
  up: string;
  down: string;
  left: string;
  right: string;
  drop: string;
  dropAlt: string;
  emote1: string;
  emote2: string;
  emote3: string;
  emote4: string;
}

export interface Settings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  reducedShake: boolean;
  colorblindPalette: boolean;
  latency: number;
  keybinds: Keybinds;
}

export const DEFAULT_KEYBINDS: Keybinds = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  drop: 'Space',
  dropAlt: 'KeyE',
  emote1: 'Digit1',
  emote2: 'Digit2',
  emote3: 'Digit3',
  emote4: 'Digit4',
};

const SETTINGS_KEY = 'splash-critters.settings';
const TOKEN_KEY = 'splash-critters.token';
const NAME_KEY = 'splash-critters.name';
const TUTORIAL_KEY = 'splash-critters.tutorial';

export function loadSettings(): Settings {
  const defaults: Settings = {
    sfxVolume: 0.6,
    musicVolume: 0.35,
    muted: false,
    reducedShake: false,
    colorblindPalette: false,
    latency: 0,
    keybinds: { ...DEFAULT_KEYBINDS },
  };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaults,
      ...parsed,
      keybinds: { ...defaults.keybinds, ...(parsed.keybinds ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage is optional */
  }
}

export function loadToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage is optional */
  }
}

export function loadNickname(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage is optional */
  }
}

export function tutorialDone(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* storage is optional */
  }
}

export interface QueueState {
  mode: Mode;
  elapsedMs: number;
  searchRange: number;
  queued: number;
  eta: number;
}

export interface AppState {
  screen: ScreenName;
  profile: PlayerProfile | null;
  playerId: string | null;
  settings: Settings;
  queue: QueueState | null;
  toast: { message: string; until: number } | null;
  latencyFlag: number;
}

export function defaultProfile(): PlayerProfile {
  return {
    id: '',
    nickname: 'guest',
    tag: '0000',
    animal: 'frog' as AnimalId,
    hat: 'none' as HatId,
    xp: 0,
    level: 1,
    tier: 'Puddle',
    ratingDuel: 1000,
    ratingFfa: 1000,
    gamesDuel: 0,
    gamesFfa: 0,
    unlocks: ['frog', 'duck', 'none'],
    hasNickname: false,
  };
}
