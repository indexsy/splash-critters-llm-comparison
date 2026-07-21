import type { Animal, Hat } from "@splash/shared";
import { ANIMAL_LIST, HAT_LIST } from "../ui.js";

const SETTINGS_KEY = "splash.settings.v1";
const COSMETIC_KEY = "splash.cosmetic.v1";
const TUTORIAL_KEY = "splash.tutorial.v1";

export type ColorblindMode = "off" | "protan" | "deutan" | "tritan";

export interface Keybinds {
  up: string;
  down: string;
  left: string;
  right: string;
  balloon: string;
  revenge: string;
  ready: string;
  emote1: string;
  emote2: string;
  emote3: string;
  emote4: string;
}

export const DEFAULT_KEYBINDS: Keybinds = {
  up: "W",
  down: "S",
  left: "A",
  right: "D",
  balloon: "Space",
  revenge: "E",
  ready: "R",
  emote1: "1",
  emote2: "2",
  emote3: "3",
  emote4: "4"
};

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
  keybinds: Keybinds;
  colorblind: ColorblindMode;
  reducedShake: boolean;
  acknowledgedToken: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  muted: false,
  keybinds: { ...DEFAULT_KEYBINDS },
  colorblind: "off",
  reducedShake: false,
  acknowledgedToken: false
};

export interface Cosmetics {
  animal: Animal;
  hat: Hat;
}

export const DEFAULT_COSMETICS: Cosmetics = { animal: "frog", hat: "none" };

export class SettingsManager {
  private settings: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    this.settings = this.load();
  }

  private load(): Settings {
    let parsed: Partial<Settings> = {};
    try { parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>; } catch { /* ignore */ }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      keybinds: { ...DEFAULT_KEYBINDS, ...(parsed.keybinds ?? {}) }
    };
  }

  save(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  get(): Settings { return this.settings; }

  update(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.save();
    this.emit();
    return this.settings;
  }

  updateKeybind<K extends keyof Keybinds>(key: K, value: string): void {
    this.settings = { ...this.settings, keybinds: { ...this.settings.keybinds, [key]: value } };
    this.save();
    this.emit();
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    fn(this.settings);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.settings);
  }
}

export class CosmeticManager {
  private current: Cosmetics;
  private listeners = new Set<(c: Cosmetics) => void>();

  constructor(initial?: Cosmetics) {
    this.current = this.load(initial);
  }

  private load(initial?: Cosmetics): Cosmetics {
    if (initial) {
      this.persist(initial);
      return initial;
    }
    try {
      const raw = localStorage.getItem(COSMETIC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Cosmetics>;
        return {
          animal: (parsed.animal && ANIMAL_LIST.includes(parsed.animal) ? parsed.animal : DEFAULT_COSMETICS.animal),
          hat: (parsed.hat && HAT_LIST.includes(parsed.hat) ? parsed.hat : DEFAULT_COSMETICS.hat)
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_COSMETICS };
  }

  private persist(c: Cosmetics): void {
    try { localStorage.setItem(COSMETIC_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  }

  get(): Cosmetics { return this.current; }

  set(c: Cosmetics): void {
    this.current = c;
    this.persist(c);
    this.emit();
  }

  setAnimal(a: Animal): Cosmetics {
    this.set({ ...this.current, animal: a });
    return this.current;
  }

  setHat(h: Hat): Cosmetics {
    this.set({ ...this.current, hat: h });
    return this.current;
  }

  subscribe(fn: (c: Cosmetics) => void): () => void {
    this.listeners.add(fn);
    fn(this.current);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.current);
  }
}

export function isTutorialDone(): boolean {
  try { return localStorage.getItem(TUTORIAL_KEY) === "1"; } catch { return false; }
}

export function markTutorialDone(): void {
  try { localStorage.setItem(TUTORIAL_KEY, "1"); } catch { /* ignore */ }
}
