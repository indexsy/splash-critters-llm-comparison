// Keyboard input via KeyboardEvent.code and the remappable binds in settings.
//  - Directions: the most recently pressed still-held direction wins. While gameplay is active
//    a 60 Hz sampler records the direction held during each window, and key-down edges are
//    latched, so taps shorter than a 30 Hz client tick still produce one tick of input.
//  - Balloon and emote presses are latched edges, consumed once per client tick.
//  - Game keys are preventDefault-ed only while gameplay is active and never while the player
//    is typing into a text field. The mute bind toggles settings.muted everywhere.
import { CONFIG, Dir, type DirCode, type EmoteId } from '@splash/shared';
import { settings, type BindAction, type Settings } from './settings';
import { isTypingTarget } from './ui/dom';
import { toast } from './ui/toast';

type CaptureCallback = (code: string | null) => void;

const DIR_OF_ACTION: Partial<Record<BindAction, DirCode>> = {
  up: Dir.Up,
  down: Dir.Down,
  left: Dir.Left,
  right: Dir.Right,
};

const EMOTE_OF_ACTION: Partial<Record<BindAction, EmoteId>> = {
  emote1: 0,
  emote2: 1,
  emote3: 2,
  emote4: 3,
};

const SAMPLE_MS = 1000 / CONFIG.INPUT_SAMPLE_HZ;

let actionByCode = new Map<string, BindAction>();
const heldCodes = new Set<string>();
/** Held directions in press order; the last entry is the active one. */
let dirStack: DirCode[] = [];
/**
 * Latest direction pressed (edge) or seen held by the 60 Hz sampler since the previous
 * currentDir() call: a tap released before the client tick still counts once.
 */
let recentDir: DirCode = Dir.None;
/** A direction key went down since the input clock last looked (see consumeDirPress). */
let dirPressLatch = false;
let balloonLatch = false;
let emoteLatch: EmoteId | null = null;
let gameplayActive = false;
let samplerTimer = 0;
let captureCallback: CaptureCallback | null = null;
let installed = false;

function rebuildBindings(s: Readonly<Settings>): void {
  const map = new Map<string, BindAction>();
  for (const [action, codes] of Object.entries(s.keybinds) as [BindAction, string[]][]) {
    for (const code of codes) if (!map.has(code)) map.set(code, action);
  }
  actionByCode = map;
}

function heldDir(): DirCode {
  return dirStack.length > 0 ? dirStack[dirStack.length - 1] : Dir.None;
}

function isDirStillHeld(dir: DirCode): boolean {
  for (const code of heldCodes) {
    const action = actionByCode.get(code);
    if (action && DIR_OF_ACTION[action] === dir) return true;
  }
  return false;
}

function clearLatches(): void {
  recentDir = Dir.None;
  dirPressLatch = false;
  balloonLatch = false;
  emoteLatch = null;
}

function releaseAll(): void {
  heldCodes.clear();
  dirStack = [];
  clearLatches();
}

function sample(): void {
  const dir = heldDir();
  if (dir !== Dir.None) recentDir = dir;
}

function startSampler(): void {
  if (!samplerTimer) samplerTimer = window.setInterval(sample, SAMPLE_MS);
}

function stopSampler(): void {
  window.clearInterval(samplerTimer);
  samplerTimer = 0;
}

function toggleMute(): void {
  const muted = !settings.get().muted;
  settings.set({ muted });
  toast(muted ? 'Sound off' : 'Sound on', 'info');
}

function captureKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  const cb = captureCallback;
  captureCallback = null;
  cb?.(e.code === 'Escape' ? null : e.code);
}

function pressAction(action: BindAction): void {
  const dir = DIR_OF_ACTION[action];
  if (dir !== undefined) {
    dirStack = dirStack.filter((d) => d !== dir);
    dirStack.push(dir);
    recentDir = dir;
    dirPressLatch = gameplayActive;
    return;
  }
  if (!gameplayActive) return;
  if (action === 'balloon') balloonLatch = true;
  const emote = EMOTE_OF_ACTION[action];
  if (emote !== undefined) emoteLatch = emote;
}

/**
 * Adopt a key that was already held when input state was reset (focus loss, remap): its OS
 * auto-repeat proves it is down. A resumed direction ranks below every press seen since the
 * reset, and a repeat never latches a new balloon or emote press.
 */
function resumeHeld(action: BindAction): void {
  const dir = DIR_OF_ACTION[action];
  if (dir !== undefined && !dirStack.includes(dir)) dirStack.unshift(dir);
}

function onKeyDown(e: KeyboardEvent): void {
  if (captureCallback) {
    captureKey(e);
    return;
  }
  if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const action = actionByCode.get(e.code);
  if (!action) return;
  if (action === 'mute') {
    if (!e.repeat) toggleMute();
    return;
  }
  if (gameplayActive) e.preventDefault();
  if (heldCodes.has(e.code)) return;
  heldCodes.add(e.code);
  if (e.repeat) resumeHeld(action);
  else pressAction(action);
}

function onKeyUp(e: KeyboardEvent): void {
  if (!heldCodes.delete(e.code)) return;
  if (gameplayActive) e.preventDefault();
  const action = actionByCode.get(e.code);
  const dir = action ? DIR_OF_ACTION[action] : undefined;
  if (dir !== undefined && !isDirStillHeld(dir)) dirStack = dirStack.filter((d) => d !== dir);
}

function blurFocusedControl(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && !isTypingTarget(active)) active.blur();
}

export const input = {
  /** Install the global listeners (idempotent). Called once at boot. */
  init(): void {
    if (installed) return;
    installed = true;
    rebuildBindings(settings.get());
    // settings keeps the keybinds reference until the binds really change, so volume or mute
    // writes (e.g. M mid-round) never drop held keys or latched presses.
    settings.subscribe((next, prev) => {
      if (next.keybinds === prev.keybinds) return;
      rebuildBindings(next);
      releaseAll();
    });
    // Capture phase: runs before UI hotkeys/modals so game keys can be claimed first.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
  },

  /**
   * Direction for this client tick: the most recently pressed still-held direction, else the
   * last direction held or tapped since the previous call. Call exactly once per client tick.
   */
  currentDir(): DirCode {
    const held = heldDir();
    const recent = recentDir;
    recentDir = Dir.None;
    return held !== Dir.None ? held : recent;
  },

  /** The direction the next currentDir() call will return, without consuming anything. */
  peekDir(): DirCode {
    const held = heldDir();
    return held !== Dir.None ? held : recentDir;
  },

  /** True once after a direction key went down during gameplay (edge latched since the previous consume). */
  consumeDirPress(): boolean {
    const pressed = dirPressLatch;
    dirPressLatch = false;
    return pressed;
  },

  /** True once per balloon key press (edge latched since the previous consume). */
  consumeBalloon(): boolean {
    const pressed = balloonLatch;
    balloonLatch = false;
    return pressed;
  },

  /** The latest emote key pressed since the previous consume, else null. */
  consumeEmote(): EmoteId | null {
    const emote = emoteLatch;
    emoteLatch = null;
    return emote;
  },

  /** Drop pending taps and presses (e.g. at round start so intro presses do not leak in). */
  clearLatches,

  /**
   * While active, game keys are preventDefault-ed (no page scroll / button activation), the
   * 60 Hz sampler runs and balloon/emote presses are latched.
   */
  setGameplayActive(on: boolean): void {
    if (on === gameplayActive) return;
    gameplayActive = on;
    clearLatches();
    if (on) {
      blurFocusedControl();
      startSampler();
    } else {
      stopSampler();
    }
  },

  /**
   * Deliver the next key press's code to `cb` (for remapping) instead of normal handling.
   * Escape cancels with `null`. Returns a function that cancels the capture.
   */
  captureNextKey(cb: CaptureCallback): () => void {
    captureCallback = cb;
    return () => {
      if (captureCallback === cb) captureCallback = null;
    };
  },
};
