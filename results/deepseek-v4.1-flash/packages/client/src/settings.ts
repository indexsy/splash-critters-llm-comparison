export type Action = "up" | "down" | "left" | "right" | "drop";
export type Bindings = Record<Action, string[]>;

export interface SettingsData {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
  bindings: Bindings;
  devLatency: number;
}

const STORAGE_KEY = "splash:settings";

const DEFAULT_SETTINGS: SettingsData = {
  musicVolume: 0.5,
  sfxVolume: 0.7,
  muted: false,
  colorblind: false,
  reducedShake: false,
  bindings: {
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    drop: ["Space", "KeyE"],
  },
  devLatency: 0,
};

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.replace("Arrow", "ARROW ");
  if (code === "Space") return "SPACE";
  if (code === "Escape") return "ESC";
  if (code === "Enter") return "ENTER";
  return code.toUpperCase();
}

export class SettingsStore {
  data: SettingsData;

  constructor() {
    this.data = this.load();
  }

  private load(): SettingsData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_SETTINGS);
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      return {
        ...structuredClone(DEFAULT_SETTINGS),
        ...parsed,
        bindings: {
          ...structuredClone(DEFAULT_SETTINGS.bindings),
          ...(parsed.bindings ?? {}),
        },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      return;
    }
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    this.save();
  }

  matches(action: Action, code: string): boolean {
    return this.data.bindings[action].includes(code);
  }

  rebind(action: Action, code: string): void {
    const used = new Set<string>();
    for (const [name, codes] of Object.entries(this.data.bindings)) {
      if (name === action) continue;
      this.data.bindings[name as Action] = codes.filter((entry) => entry !== code);
      for (const entry of this.data.bindings[name as Action]) used.add(entry);
    }
    const aliases: Record<Action, string> = {
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      drop: "",
    };
    const next = [code];
    if (aliases[action] && !used.has(aliases[action])) next.push(aliases[action]);
    this.data.bindings[action] = next;
    this.save();
  }

  reset(): void {
    this.data = structuredClone(DEFAULT_SETTINGS);
    this.save();
  }
}
