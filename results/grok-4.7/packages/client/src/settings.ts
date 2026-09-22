export interface Settings {
  sfx: number;
  music: number;
  mute: boolean;
  shake: boolean;
  colorblind: boolean;
  keys: {
    up: string;
    down: string;
    left: string;
    right: string;
    balloon: string;
    balloon2: string;
    emotes: [string, string, string, string];
  };
}

const KEY = 'splash.settings';

export const DEFAULT_SETTINGS: Settings = {
  sfx: 0.7,
  music: 0.35,
  mute: false,
  shake: true,
  colorblind: false,
  keys: {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    balloon: 'Space',
    balloon2: 'KeyE',
    emotes: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
