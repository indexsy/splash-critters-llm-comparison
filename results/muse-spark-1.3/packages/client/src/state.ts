import type { AnimalId, HatId } from '@splash/shared';

export interface Profile {
  playerId: string;
  token: string;
  nickname: string;
  tag: string;
  level: number;
  xp: number;
  animal: AnimalId;
  hat: HatId;
}

export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  colorblind: boolean;
  shake: boolean;
  keys: { up: string; down: string; left: string; right: string; balloon: string };
}

const DEF_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', balloon: 'Space' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('sc_settings');
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults();
}

function defaults(): Settings {
  return { sfx: 0.7, music: 0.5, muted: false, colorblind: false, shake: true, keys: { ...DEF_KEYS } };
}

export function saveSettings(s: Settings): void {
  localStorage.setItem('sc_settings', JSON.stringify(s));
}

export const app: {
  profile: Profile | null;
  settings: Settings;
  params: URLSearchParams;
} = {
  profile: null,
  settings: loadSettings(),
  params: new URLSearchParams(location.search),
};

export function setProfile(p: Profile): void {
  app.profile = p;
}
