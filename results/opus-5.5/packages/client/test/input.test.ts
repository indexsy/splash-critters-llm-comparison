// Keyboard input against the real settings module: the mute bind mid-round must not drop held
// directions or latched presses, a real remap still does, and a key held through a reset
// (focus loss) resumes from its OS auto-repeat without latching a new press. The browser is
// stubbed with Node's EventTarget; toasts are mocked because they need the DOM overlay.
import { Dir } from '@splash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/toast', () => ({ toast: vi.fn() }));

type InputModule = typeof import('../src/input');
type SettingsModule = typeof import('../src/settings');

class FakeElement extends EventTarget {}

let win: EventTarget & { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
let input: InputModule['input'];
let settings: SettingsModule['settings'];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  win = Object.assign(new EventTarget(), {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, activeElement: null, body: null }));
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
    vi.stubGlobal(name, class extends FakeElement {});
  }
  ({ settings } = await import('../src/settings'));
  ({ input } = await import('../src/input'));
  input.init();
  input.setGameplayActive(true);
});

afterEach(() => {
  input.setGameplayActive(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Dispatch a keyboard event; returns true when input.ts called preventDefault. */
function key(type: 'keydown' | 'keyup', code: string, repeat = false): boolean {
  const e = Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey: false, metaKey: false, altKey: false });
  win.dispatchEvent(e);
  return e.defaultPrevented;
}

function tap(code: string): void {
  key('keydown', code);
  key('keyup', code);
}

describe('mute bind during gameplay', () => {
  it('keeps the held direction and the latched balloon press', () => {
    key('keydown', 'KeyD');
    tap('Space');
    tap('KeyM');
    expect(settings.get().muted).toBe(true);
    key('keydown', 'KeyD', true);
    expect(input.currentDir()).toBe(Dir.Right);
    expect(input.consumeBalloon()).toBe(true);
    tap('KeyM');
    expect(settings.get().muted).toBe(false);
    expect(input.currentDir()).toBe(Dir.Right);
    key('keyup', 'KeyD');
    expect(input.currentDir()).toBe(Dir.None);
  });

  it('keeps a latched emote and direction order across volume writes', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    tap('Digit3');
    settings.set({ sfxVolume: 0.2, musicVolume: 0.1 });
    expect(input.currentDir()).toBe(Dir.Left);
    expect(input.consumeEmote()).toBe(2);
    key('keyup', 'KeyA');
    expect(input.currentDir()).toBe(Dir.Up);
  });
});

describe('remapping', () => {
  it('still releases held keys and applies the new bind', () => {
    key('keydown', 'KeyD');
    settings.bindKey('right', 0, 'KeyL');
    expect(input.currentDir()).toBe(Dir.None);
    key('keyup', 'KeyD');
    key('keydown', 'KeyD');
    expect(input.currentDir()).toBe(Dir.None);
    key('keydown', 'KeyL');
    expect(input.currentDir()).toBe(Dir.Right);
  });
});

describe('keys held through a focus-loss reset', () => {
  it('resume a direction from auto-repeat', () => {
    key('keydown', 'KeyD');
    win.dispatchEvent(new Event('blur'));
    expect(input.currentDir()).toBe(Dir.None);
    expect(key('keydown', 'KeyD', true)).toBe(true);
    expect(input.currentDir()).toBe(Dir.Right);
    key('keyup', 'KeyD');
    expect(input.currentDir()).toBe(Dir.None);
  });

  it('never latch a balloon or emote from auto-repeat', () => {
    key('keydown', 'Space');
    key('keydown', 'Digit1');
    win.dispatchEvent(new Event('blur'));
    key('keydown', 'Space', true);
    key('keydown', 'Digit1', true);
    expect(input.consumeBalloon()).toBe(false);
    expect(input.consumeEmote()).toBeNull();
    key('keyup', 'Space');
    tap('Space');
    expect(input.consumeBalloon()).toBe(true);
  });

  it('rank a resumed direction below presses seen since the reset', () => {
    key('keydown', 'KeyD');
    win.dispatchEvent(new Event('blur'));
    key('keydown', 'KeyW');
    key('keydown', 'KeyD', true);
    expect(input.currentDir()).toBe(Dir.Up);
    key('keyup', 'KeyW');
    expect(input.currentDir()).toBe(Dir.Right);
  });
});

describe('input clock hints', () => {
  it('latch a direction press once and peek without consuming', () => {
    expect(input.consumeDirPress()).toBe(false);
    key('keydown', 'KeyS');
    expect(input.peekDir()).toBe(Dir.Down);
    expect(input.consumeDirPress()).toBe(true);
    expect(input.consumeDirPress()).toBe(false);
    key('keyup', 'KeyS');
    // A tap released before the tick still heads that way until the tick consumes it.
    expect(input.peekDir()).toBe(Dir.Down);
    expect(input.currentDir()).toBe(Dir.Down);
    expect(input.peekDir()).toBe(Dir.None);
  });

  it('never latch a direction press from auto-repeat or outside gameplay', () => {
    key('keydown', 'KeyD');
    input.clearLatches();
    key('keydown', 'KeyD', true);
    expect(input.consumeDirPress()).toBe(false);
    key('keyup', 'KeyD');
    input.setGameplayActive(false);
    key('keydown', 'KeyA');
    expect(input.consumeDirPress()).toBe(false);
  });
});
