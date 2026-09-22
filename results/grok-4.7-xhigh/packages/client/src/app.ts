import type { LobbyState, MatchStartMsg, Profile, RoundStartMsg, ServerMsg, SnapshotMsg } from '@splash/shared';

export interface Binds {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  balloon: string[];
  mute: string[];
}

export interface Settings {
  sfx: number;
  music: number;
  mute: boolean;
  colorblind: boolean;
  shake: boolean;
  lag: number;
  binds: Binds;
}

const defaultSettings = (): Settings => ({
  sfx: 0.45,
  music: 0.22,
  mute: false,
  colorblind: false,
  shake: true,
  lag: 0,
  binds: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    balloon: ['Space', 'KeyE'],
    mute: ['KeyM'],
  },
});

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('splash_settings');
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw), binds: { ...defaultSettings().binds, ...JSON.parse(raw).binds } };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem('splash_settings', JSON.stringify(s));
}

type MatchEnd = Extract<ServerMsg, { t: 'match_end' }>;

export const app = {
  profile: null as Profile | null,
  settings: loadSettings(),
  match: null as MatchStartMsg | null,
  round: null as RoundStartMsg | null,
  snap: null as SnapshotMsg | null,
  lobby: null as LobbyState | null,
  result: null as MatchEnd | null,
  xpAtStart: 0,
  connected: false,
  rtt: 0,
  screen: '',
};

export function toast(msg: string) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function mount(html: string): HTMLElement {
  const root = document.getElementById('app')!;
  root.innerHTML = html;
  return root;
}

export function qs<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}

export function lagMs(): number {
  const q = Number(new URLSearchParams(location.search).get('lag') || 0);
  if (q > 0) return q;
  return app.settings.lag || 0;
}

export function tierClass(name: string): string {
  return name.toLowerCase();
}
