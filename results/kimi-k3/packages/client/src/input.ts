import { DIR_DOWN, DIR_LEFT, DIR_NONE, DIR_RIGHT, DIR_UP, type Dir } from '@splash/shared';
import type { Keys } from './screens/common.js';

const DEFAULT_BINDS: Record<string, string> = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  balloon: 'Space',
  balloon2: 'KeyE',
  emote1: 'Digit1',
  emote2: 'Digit2',
  emote3: 'Digit3',
  emote4: 'Digit4',
  mute: 'KeyM',
};

export function loadBinds(): Record<string, string> {
  try {
    const raw = localStorage.getItem('splash_binds');
    if (raw) return { ...DEFAULT_BINDS, ...JSON.parse(raw) };
  } catch {
    /* */
  }
  return { ...DEFAULT_BINDS };
}

export function saveBinds(b: Record<string, string>): void {
  localStorage.setItem('splash_binds', JSON.stringify(b));
}

export function dirFromKeys(keys: Keys, binds: Record<string, string>): Dir {
  const d = keys.down;
  // also arrows
  if (d.has(binds.up) || d.has('ArrowUp')) return DIR_UP;
  if (d.has(binds.down) || d.has('ArrowDown')) return DIR_DOWN;
  if (d.has(binds.left) || d.has('ArrowLeft')) return DIR_LEFT;
  if (d.has(binds.right) || d.has('ArrowRight')) return DIR_RIGHT;
  return DIR_NONE;
}

export function balloonPressed(keys: Keys, binds: Record<string, string>): boolean {
  return keys.pressed.has(binds.balloon) || keys.pressed.has(binds.balloon2);
}

export function emotePressed(keys: Keys, binds: Record<string, string>): number {
  if (keys.pressed.has(binds.emote1)) return 0;
  if (keys.pressed.has(binds.emote2)) return 1;
  if (keys.pressed.has(binds.emote3)) return 2;
  if (keys.pressed.has(binds.emote4)) return 3;
  return -1;
}
