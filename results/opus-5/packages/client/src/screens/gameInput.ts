/**
 * Keyboard for the in-match screen.
 *
 * Two clocks, deliberately different: the keyboard is sampled at
 * INPUT_SAMPLE_HZ so a direction change is picked up within a frame, and an
 * input message is emitted at INPUT_SEND_HZ so the wire stays at tick rate.
 * Direction comes from the most recently pressed of the held keys rather than a
 * fixed priority order, which is what makes tapping a new direction feel instant
 * while you are still holding the old one.
 *
 * The drop key is edge triggered: one press is one balloon, however long the key
 * stays down. The server enforces the same rule, so holding it never queues.
 */

import { CONFIG, Dir, type DirValue, type PlayerInput } from '@splash/shared';
import { inputTick } from '../net';
import { actionForCode, type ActionId } from '../settings';

const DIR_FOR_ACTION: Partial<Record<ActionId, DirValue>> = {
  up: Dir.UP,
  down: Dir.DOWN,
  left: Dir.LEFT,
  right: Dir.RIGHT,
};

const EMOTE_ACTIONS: ActionId[] = ['emote1', 'emote2', 'emote3', 'emote4'];

/** Keys the browser would otherwise use to scroll the page out from under us. */
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface GameInputOptions {
  /** One sampled input, ready to predict locally and put on the wire. */
  onInput(input: PlayerInput): void;
  onEmote(id: number): void;
  onMute(): void;
  onEscape(): void;
  /** False while a dialog owns the keyboard; keys fall through to the DOM. */
  enabled(): boolean;
}

export interface GameInput {
  start(): void;
  stop(): void;
  /** Drive from the screen's frame hook. */
  update(dtMs: number): void;
}

function typingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function createGameInput(opts: GameInputOptions): GameInput {
  const sampleMs = 1000 / CONFIG.INPUT_SAMPLE_HZ;
  const sendMs = 1000 / CONFIG.INPUT_SEND_HZ;

  /** Held directions in press order; the newest one wins. */
  const held: DirValue[] = [];
  let sampledDir: DirValue = Dir.NONE;
  let dropLatched = false;
  let sampleAcc = 0;
  let sendAcc = 0;
  let seq = 0;
  let bound = false;

  function press(dir: DirValue): void {
    const at = held.indexOf(dir);
    if (at >= 0) held.splice(at, 1);
    held.push(dir);
  }

  function release(dir: DirValue): void {
    const at = held.indexOf(dir);
    if (at >= 0) held.splice(at, 1);
  }

  function clearHeld(): void {
    held.length = 0;
    dropLatched = false;
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || typingTarget(ev.target)) return;
    if (ev.code === 'Escape') {
      ev.preventDefault();
      opts.onEscape();
      return;
    }
    if (!opts.enabled()) return;

    const action = actionForCode(ev.code);
    if (action === null) {
      // M mutes, unless the player has bound M to something of their own.
      if (ev.code === 'KeyM' && !ev.repeat) opts.onMute();
      return;
    }
    if (SCROLL_KEYS.has(ev.code)) ev.preventDefault();
    if (ev.repeat) return;

    const dir = DIR_FOR_ACTION[action];
    if (dir !== undefined) {
      press(dir);
      return;
    }
    if (action === 'drop') {
      dropLatched = true;
      return;
    }
    const emote = EMOTE_ACTIONS.indexOf(action);
    if (emote >= 0) opts.onEmote(emote);
  }

  function onKeyUp(ev: KeyboardEvent): void {
    const action = actionForCode(ev.code);
    if (action === null) return;
    if (SCROLL_KEYS.has(ev.code)) ev.preventDefault();
    const dir = DIR_FOR_ACTION[action];
    if (dir !== undefined) release(dir);
  }

  return {
    start(): void {
      if (bound) return;
      bound = true;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      // Alt-tabbing away with a key down must not leave the critter sprinting.
      window.addEventListener('blur', clearHeld);
    },

    stop(): void {
      if (!bound) return;
      bound = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
      clearHeld();
    },

    update(dtMs: number): void {
      if (!opts.enabled()) clearHeld();

      sampleAcc += dtMs;
      while (sampleAcc >= sampleMs) {
        sampleAcc -= sampleMs;
        sampledDir = held.length > 0 ? held[held.length - 1] : Dir.NONE;
      }

      sendAcc += dtMs;
      while (sendAcc >= sendMs) {
        sendAcc -= sendMs;
        seq++;
        opts.onInput({ seq, tick: inputTick(), dir: sampledDir, balloonPressed: dropLatched });
        dropLatched = false;
      }
    },
  };
}
