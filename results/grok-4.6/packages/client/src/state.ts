import type { Profile, ServerMsg } from "@splash/shared";

export interface Settings {
  sfx: number;
  music: number;
  colorblind: boolean;
  reduceShake: boolean;
  binds: Record<string, string>;
}

export const settings: Settings = loadSettings();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("splash_settings");
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultSettings();
}

function defaultSettings(): Settings {
  return {
    sfx: 0.7,
    music: 0.45,
    colorblind: false,
    reduceShake: false,
    binds: {
      up: "KeyW",
      down: "KeyS",
      left: "KeyA",
      right: "KeyD",
      balloon: "Space",
      balloon2: "KeyE",
    },
  };
}

export function saveSettings(): void {
  localStorage.setItem("splash_settings", JSON.stringify(settings));
}

export const app = {
  profile: null as Profile | null,
  playerId: "",
  seenTutorial: localStorage.getItem("splash_tutorial") === "1",
  lastError: "",
  latencyFlag: Number(new URLSearchParams(location.search).get("lag") ?? 0),
};

export function applyWelcome(msg: Extract<ServerMsg, { type: "welcome" }>): void {
  app.profile = msg.profile;
  app.playerId = msg.playerId;
}
