/**
 * Keyboard input. Tracks held movement keys (last-pressed wins), the balloon
 * edge, emote keys (1-4) and mute (M). Also supports capturing a key for rebinding.
 */

import type { Dir } from '@splash/shared';
import { store, type BindAction } from './store';

const MOVE: BindAction[] = ['up', 'down', 'left', 'right'];
const ACTION_DIR: Record<string, Dir> = { up: 'up', down: 'down', left: 'left', right: 'right' };

export class InputManager {
  private held = new Set<BindAction>();
  private order: BindAction[] = [];
  private balloonEdge = false;
  private emotes: number[] = [];
  private capture: ((code: string) => void) | null = null;
  enabled = true;

  onMute: () => void = () => {};

  start(): void {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.reset());
  }

  setCapture(cb: (code: string) => void): void {
    this.capture = cb;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    const action = store.actionForCode(e.code);
    if (action || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;

    if (e.code === 'KeyM') {
      store.settings.muted = !store.settings.muted;
      store.saveSettings();
      this.onMute();
      return;
    }
    if (/^Digit[1-4]$/.test(e.code)) {
      this.emotes.push(Number(e.code.slice(5)));
      return;
    }
    if (!action) return;
    if (MOVE.includes(action)) {
      this.held.add(action);
      this.order = this.order.filter((a) => a !== action);
      this.order.push(action);
    } else if (action === 'balloon') {
      this.balloonEdge = true;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const action = store.actionForCode(e.code);
    if (!action) return;
    if (MOVE.includes(action)) {
      this.held.delete(action);
      this.order = this.order.filter((a) => a !== action);
    }
  }

  private reset(): void {
    this.held.clear();
    this.order = [];
  }

  pollDir(): Dir | null {
    if (!this.enabled) return null;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const a = this.order[i];
      if (this.held.has(a)) return ACTION_DIR[a];
    }
    return null;
  }

  takeBalloon(): boolean {
    if (!this.enabled) {
      this.balloonEdge = false;
      return false;
    }
    const b = this.balloonEdge;
    this.balloonEdge = false;
    return b;
  }

  takeEmote(): number | null {
    if (!this.emotes.length) return null;
    return this.emotes.shift() ?? null;
  }
}

export const input = new InputManager();
