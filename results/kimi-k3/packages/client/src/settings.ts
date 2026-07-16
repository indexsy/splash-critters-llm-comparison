export interface Settings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
  keys: {
    up: string;
    down: string;
    left: string;
    right: string;
    balloon: string;
  };
}

const DEFAULTS: Settings = {
  sfxVolume: 0.7,
  musicVolume: 0.4,
  muted: false,
  colorblind: false,
  reducedShake: false,
  keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', balloon: 'Space' },
};

const KEY = 'splash-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, keys: { ...DEFAULTS.keys } };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed, keys: { ...DEFAULTS.keys, ...(parsed.keys ?? {}) } };
  } catch {
    return { ...DEFAULTS, keys: { ...DEFAULTS.keys } };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export const settings = loadSettings();
