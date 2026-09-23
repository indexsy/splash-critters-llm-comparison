// Persisted player settings (localStorage 'splash.settings'): volumes, mute, accessibility
// toggles and remappable keybinds. Values are validated on load so a corrupt or outdated
// blob never breaks the client; unknown keys are dropped, missing ones fall back to defaults.
import { CONFIG } from '@splash/shared';
import { storage } from './storage';

export type BindAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'balloon'
  | 'emote1'
  | 'emote2'
  | 'emote3'
  | 'emote4'
  | 'mute';

/** KeyboardEvent.code values per action (primary first, then alternate). */
export type Keybinds = Record<BindAction, string[]>;

export interface Settings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
  showPing: boolean;
  keybinds: Keybinds;
}

/** Display order for keybind lists. */
export const BIND_ACTIONS: readonly BindAction[] = [
  'up',
  'down',
  'left',
  'right',
  'balloon',
  'emote1',
  'emote2',
  'emote3',
  'emote4',
  'mute',
];

export const BIND_LABELS: Record<BindAction, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  balloon: 'Drop balloon',
  emote1: `Emote: ${CONFIG.EMOTE_NAMES[0]}`,
  emote2: `Emote: ${CONFIG.EMOTE_NAMES[1]}`,
  emote3: `Emote: ${CONFIG.EMOTE_NAMES[2]}`,
  emote4: `Emote: ${CONFIG.EMOTE_NAMES[3]}`,
  mute: 'Mute / unmute',
};

/** Each action holds at most this many keys (primary + alternate). */
export const MAX_BINDS_PER_ACTION = 2;

const STORAGE_KEY = 'splash.settings';

const DEFAULT_KEYBINDS: Keybinds = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  balloon: ['Space', 'KeyE'],
  emote1: ['Digit1'],
  emote2: ['Digit2'],
  emote3: ['Digit3'],
  emote4: ['Digit4'],
  mute: ['KeyM'],
};

const DEFAULTS: Omit<Settings, 'keybinds'> = {
  sfxVolume: 0.8,
  musicVolume: 0.5,
  muted: false,
  colorblind: false,
  reducedShake: false,
  showPing: true,
};

type Listener = (next: Settings, prev: Settings) => void;

function cloneKeybinds(k: Keybinds): Keybinds {
  const out = {} as Keybinds;
  for (const action of BIND_ACTIONS) out[action] = [...k[action]];
  return out;
}

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Valid binds per action: strings only, deduplicated, each code used by one action at most. */
function sanitizeKeybinds(raw: unknown): Keybinds {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const used = new Set<string>();
  const out = {} as Keybinds;
  for (const action of BIND_ACTIONS) {
    const list = src[action];
    const codes = Array.isArray(list) ? list : DEFAULT_KEYBINDS[action];
    out[action] = [];
    for (const code of codes) {
      if (typeof code !== 'string' || code.length === 0 || code.length > 32 || used.has(code)) continue;
      if (out[action].length >= MAX_BINDS_PER_ACTION) break;
      used.add(code);
      out[action].push(code);
    }
  }
  return out;
}

function sanitize(raw: unknown): Settings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    sfxVolume: clamp01(src.sfxVolume, DEFAULTS.sfxVolume),
    musicVolume: clamp01(src.musicVolume, DEFAULTS.musicVolume),
    muted: bool(src.muted, DEFAULTS.muted),
    colorblind: bool(src.colorblind, DEFAULTS.colorblind),
    reducedShake: bool(src.reducedShake, DEFAULTS.reducedShake),
    showPing: bool(src.showPing, DEFAULTS.showPing),
    keybinds: sanitizeKeybinds(src.keybinds ?? DEFAULT_KEYBINDS),
  };
}

const SCALAR_KEYS = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];

function sameKeybinds(a: Keybinds, b: Keybinds): boolean {
  return BIND_ACTIONS.every((action) => a[action].length === b[action].length && a[action].every((code, i) => code === b[action][i]));
}

let current: Settings = sanitize(storage.getJson(STORAGE_KEY));
const listeners = new Set<Listener>();

/**
 * Store, persist and announce `candidate`. `keybinds` keeps its object identity until the binds
 * really change (subscribers such as input.ts treat a new reference as a remap and drop held
 * keys), and a write that changes nothing is skipped without notifying anyone.
 */
function commit(candidate: Settings, persist = true): void {
  const prev = current;
  const keybinds = sameKeybinds(candidate.keybinds, prev.keybinds) ? prev.keybinds : candidate.keybinds;
  if (keybinds === prev.keybinds && SCALAR_KEYS.every((key) => candidate[key] === prev[key])) return;
  const next: Settings = { ...candidate, keybinds };
  current = next;
  if (persist) storage.setJson(STORAGE_KEY, next);
  for (const fn of [...listeners]) {
    try {
      fn(next, prev);
    } catch (err) {
      console.error('[settings] listener failed', err);
    }
  }
}

/**
 * Every tab of the game shares one saved settings blob. When another tab changes it (mute with
 * M, a volume, a remap) this tab adopts the change too; otherwise its next write would silently
 * put the other tab's change back.
 */
function adoptFromOtherTab(e: StorageEvent): void {
  if (e.key !== STORAGE_KEY || e.newValue === null) return;
  let raw: unknown;
  try {
    raw = JSON.parse(e.newValue);
  } catch {
    return;
  }
  commit(sanitize(raw), false);
}

if (typeof window !== 'undefined') window.addEventListener('storage', adoptFromOtherTab);

export const settings = {
  get(): Readonly<Settings> {
    return current;
  },

  /** Merge a partial update (validated), persist it and notify subscribers when anything changed. */
  set(partial: Partial<Settings>): void {
    commit(sanitize({ ...current, ...partial }));
  },

  resetKeybinds(): void {
    commit({ ...current, keybinds: cloneKeybinds(DEFAULT_KEYBINDS) });
  },

  /**
   * Bind `code` to `action` at position `index` (0 primary, 1 alternate), removing it from any
   * other action so one key never triggers two actions. `code = null` clears that position.
   */
  bindKey(action: BindAction, index: number, code: string | null): void {
    const slot = Math.max(0, Math.min(MAX_BINDS_PER_ACTION - 1, Math.floor(index)));
    const keybinds = cloneKeybinds(current.keybinds);
    if (code !== null) {
      for (const other of BIND_ACTIONS) keybinds[other] = keybinds[other].filter((c) => c !== code);
    }
    const list = keybinds[action];
    if (code === null) list.splice(slot, 1);
    else if (slot < list.length) list[slot] = code;
    else list.push(code);
    commit({ ...current, keybinds });
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
