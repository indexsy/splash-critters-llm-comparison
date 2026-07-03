import { DEFAULT_BINDINGS, type Action } from "./input.js";

export interface Settings {
  sfxVolume: number; // 0..1
  musicVolume: number;
  muted: boolean;
  colorblindSplash: boolean;
  reduceShake: boolean;
  bindings: Record<Action, string[]>;
}

const KEY = "splash-settings-v1";

export function loadSettings(): Settings {
  const base: Settings = {
    sfxVolume: 0.8,
    musicVolume: 0.5,
    muted: false,
    colorblindSplash: false,
    reduceShake: false,
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...parsed,
      bindings: { ...base.bindings, ...(parsed.bindings ?? {}) },
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private browsing) — settings just won't stick
  }
}
