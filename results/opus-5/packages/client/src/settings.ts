/** Player settings, persisted to localStorage. Read synchronously at boot. */

export type ActionId = 'up' | 'down' | 'left' | 'right' | 'drop' | 'emote1' | 'emote2' | 'emote3' | 'emote4';

export const ACTION_LABELS: Record<ActionId, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  drop: 'Drop balloon',
  emote1: 'Emote 1',
  emote2: 'Emote 2',
  emote3: 'Emote 3',
  emote4: 'Emote 4',
};

export type Keybinds = Record<ActionId, string[]>;

export interface Settings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  /** Swaps the blue splash palette for a yellow/orange one. */
  colorblindSplash: boolean;
  reducedShake: boolean;
  showPing: boolean;
  keybinds: Keybinds;
}

export const DEFAULT_KEYBINDS: Keybinds = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drop: ['Space', 'KeyE'],
  emote1: ['Digit1'],
  emote2: ['Digit2'],
  emote3: ['Digit3'],
  emote4: ['Digit4'],
};

const DEFAULTS: Settings = {
  sfxVolume: 0.7,
  musicVolume: 0.4,
  muted: false,
  colorblindSplash: false,
  reducedShake: false,
  showPing: true,
  keybinds: DEFAULT_KEYBINDS,
};

const STORAGE_KEY = 'splash-critters:settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, keybinds: cloneBinds(DEFAULT_KEYBINDS) };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...parsed,
      keybinds: { ...cloneBinds(DEFAULT_KEYBINDS), ...(parsed.keybinds ?? {}) },
    };
  } catch {
    return { ...DEFAULTS, keybinds: cloneBinds(DEFAULT_KEYBINDS) };
  }
}

function cloneBinds(binds: Keybinds): Keybinds {
  const out = {} as Keybinds;
  for (const key of Object.keys(binds) as ActionId[]) out[key] = [...binds[key]];
  return out;
}

let current = load();
const listeners = new Set<(settings: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private browsing: settings simply do not persist.
  }
  for (const listener of listeners) listener(current);
  return current;
}

export function resetKeybinds(): Settings {
  return updateSettings({ keybinds: cloneBinds(DEFAULT_KEYBINDS) });
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which action, if any, a physical key is currently bound to. */
export function actionForCode(code: string): ActionId | null {
  const binds = current.keybinds;
  for (const action of Object.keys(binds) as ActionId[]) {
    if (binds[action].includes(code)) return action;
  }
  return null;
}

// ------------------------------------------------------------- device token

const TOKEN_KEY = 'splash-critters:token';

export function getDeviceToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setDeviceToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Nothing we can do; the player gets a fresh guest next visit.
  }
}

export function clearDeviceToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore.
  }
}
