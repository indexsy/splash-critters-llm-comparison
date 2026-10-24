export type BindingAction = "up" | "down" | "left" | "right" | "balloon";

export interface ClientSettings {
  sfx: number;
  music: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
  bindings: Record<BindingAction, string>;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  sfx: 0.7,
  music: 0.35,
  muted: false,
  colorblind: false,
  reducedShake: false,
  bindings: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", balloon: "Space" }
};

export function loadSettings(): ClientSettings {
  try {
    const stored = JSON.parse(localStorage.getItem("splash-settings") ?? "null") as Partial<ClientSettings> | null;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      bindings: { ...DEFAULT_SETTINGS.bindings, ...stored?.bindings }
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: ClientSettings): void {
  localStorage.setItem("splash-settings", JSON.stringify(settings));
}

export function keyLabel(code: string): string {
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace("Arrow", "").replace("Space", "SPACE").toUpperCase();
}
