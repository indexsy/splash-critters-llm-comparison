import { NetClient } from './net.js';
import { Predictor } from './prediction.js';
import { AudioEngine } from './audio.js';
import type { Screen } from './screens/types.js';
import type { Direction } from '@shared/types.js';

import { titleScreen } from './screens/title.js';
import { tutorialScreen } from './screens/tutorial.js';
import { menuScreen } from './screens/menu.js';
import { browserScreen } from './screens/browser.js';
import { lobbyScreen } from './screens/lobby.js';
import { queueScreen } from './screens/queue.js';
import { gameScreen } from './screens/game.js';
import { resultsScreen } from './screens/results.js';
import { leaderboardScreen } from './screens/leaderboard.js';
import { lockerScreen } from './screens/locker.js';
import { settingsScreen } from './screens/settings.js';

// =============================================================================
// Constants
// =============================================================================

const INTERNAL_WIDTH = 256;
const INTERNAL_HEIGHT = 224;
const LS_TOKEN_KEY = 'sc_device_token';
const LS_SETTINGS_KEY = 'sc_settings';

// =============================================================================
// Settings
// =============================================================================

interface Settings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  keybinds: {
    up: string;
    down: string;
    left: string;
    right: string;
    balloon: string;
    emote1: string;
    emote2: string;
    emote3: string;
    emote4: string;
    mute: string;
    menu: string;
  };
  colorblindMode: boolean;
  reducedShake: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  sfxVolume: 0.8,
  musicVolume: 0.6,
  muted: false,
  keybinds: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    balloon: ' ',
    emote1: '1',
    emote2: '2',
    emote3: '3',
    emote4: '4',
    mute: 'm',
    menu: 'Escape',
  },
  colorblindMode: false,
  reducedShake: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        keybinds: {
          ...DEFAULT_SETTINGS.keybinds,
          ...(parsed.keybinds || {}),
        },
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
}

// =============================================================================
// Token / Identity
// =============================================================================

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateToken(): string {
  let token = localStorage.getItem(LS_TOKEN_KEY);
  if (!token) {
    token = generateUUID();
    localStorage.setItem(LS_TOKEN_KEY, token);
  }
  return token;
}

// =============================================================================
// Canvas Setup
// =============================================================================

export const canvas = document.createElement('canvas');
canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;
canvas.style.imageRendering = 'pixelated';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('No #app element found');
appEl.appendChild(canvas);

const ctxOrNull = canvas.getContext('2d');
if (!ctxOrNull) throw new Error('Could not get 2D rendering context');
export const ctx = ctxOrNull;

// =============================================================================
// Resize
// =============================================================================

function resize(): void {
  const scale = Math.max(
    1,
    Math.floor(
      Math.min(window.innerWidth / INTERNAL_WIDTH, window.innerHeight / INTERNAL_HEIGHT)
    )
  );
  canvas.style.width = `${INTERNAL_WIDTH * scale}px`;
  canvas.style.height = `${INTERNAL_HEIGHT * scale}px`;
}

window.addEventListener('resize', resize);
resize();

// =============================================================================
// Screen Manager
// =============================================================================

export class ScreenManager {
  private screens: Map<string, Screen> = new Map();
  private current: Screen | null = null;
  private currentName = '';

  register(name: string, screen: Screen): void {
    this.screens.set(name, screen);
  }

  switchTo(name: string, data?: unknown): void {
    if (this.current) this.current.exit();
    this.current = this.screens.get(name) ?? null;
    this.currentName = name;
    if (this.current) this.current.enter(data);
  }

  getCurrent(): Screen | null {
    return this.current;
  }

  getCurrentName(): string {
    return this.currentName;
  }
}

export const screenManager = new ScreenManager();

// =============================================================================
// Global Services
// =============================================================================

export const audioEngine = new AudioEngine();
export const netClient = new NetClient();
export const predictor = new Predictor(''); // playerId set on welcome

// =============================================================================
// Input State
// =============================================================================

const keysDown = new Set<string>();
const settings = loadSettings();

export const currentInput = {
  dir: null as Direction | null,
  balloonPressed: false,
  emoteId: undefined as number | undefined,
};

function getDirectionFromKeys(): Direction | null {
  if (
    keysDown.has(settings.keybinds.up) ||
    keysDown.has('w') ||
    keysDown.has('W')
  )
    return 'up';
  if (
    keysDown.has(settings.keybinds.down) ||
    keysDown.has('s') ||
    keysDown.has('S')
  )
    return 'down';
  if (
    keysDown.has(settings.keybinds.left) ||
    keysDown.has('a') ||
    keysDown.has('A')
  )
    return 'left';
  if (
    keysDown.has(settings.keybinds.right) ||
    keysDown.has('d') ||
    keysDown.has('D')
  )
    return 'right';
  return null;
}

function isBalloonPressed(): boolean {
  return (
    keysDown.has(settings.keybinds.balloon) ||
    keysDown.has('e') ||
    keysDown.has('E')
  );
}

function getEmoteId(): number | undefined {
  if (keysDown.has(settings.keybinds.emote1)) return 1;
  if (keysDown.has(settings.keybinds.emote2)) return 2;
  if (keysDown.has(settings.keybinds.emote3)) return 3;
  if (keysDown.has(settings.keybinds.emote4)) return 4;
  return undefined;
}

// =============================================================================
// Keyboard Handling
// =============================================================================

window.addEventListener('keydown', (e) => {
  keysDown.add(e.key);

  // Mute toggle
  if (e.key === 'm' || e.key === 'M') {
    if (audioEngine.muted) audioEngine.unmute();
    else audioEngine.mute();
  }

  // Menu / back
  if (e.key === 'Escape') {
    const name = screenManager.getCurrentName();
    if (name !== 'menu' && name !== 'title') {
      screenManager.switchTo('menu');
    }
  }

  // Update current input for the game screen
  currentInput.dir = getDirectionFromKeys();
  currentInput.balloonPressed = isBalloonPressed();
  currentInput.emoteId = getEmoteId();
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.key);
  currentInput.dir = getDirectionFromKeys();
  currentInput.balloonPressed = isBalloonPressed();
  currentInput.emoteId = getEmoteId();
});

// =============================================================================
// Register Screens
// =============================================================================

screenManager.register('title', titleScreen);
screenManager.register('tutorial', tutorialScreen);
screenManager.register('menu', menuScreen);
screenManager.register('browser', browserScreen);
screenManager.register('lobby', lobbyScreen);
screenManager.register('queue', queueScreen);
screenManager.register('game', gameScreen);
screenManager.register('results', resultsScreen);
screenManager.register('leaderboard', leaderboardScreen);
screenManager.register('locker', lockerScreen);
screenManager.register('settings', settingsScreen);

// =============================================================================
// Net Connection
// =============================================================================

const token = getOrCreateToken();
netClient.connect(token);

netClient.onMessage((msg) => {
  if (msg.type === 'welcome') {
    // Update predictor with our player id
    // The predictor needs to be recreated with the correct player id
    // We store it on the global predictor for now
  }

  // Route messages to the current screen
  const screen = screenManager.getCurrent();
  if (screen && 'handleMessage' in screen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (screen as any).handleMessage(msg);
  }
});

netClient.onClose(() => {
  // Could show a disconnected overlay; for now just log
  // eslint-disable-next-line no-console
  console.log('Disconnected from server');
});

// =============================================================================
// Game Loop
// =============================================================================

let lastTime = 0;

function gameLoop(time: number): void {
  const dt = Math.min((time - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = time;

  const screen = screenManager.getCurrent();
  if (screen) {
    screen.update(dt);
    screen.render(ctx);
  }

  requestAnimationFrame(gameLoop);
}

// =============================================================================
// Start
// =============================================================================

screenManager.switchTo('title');
audioEngine.playMusic('title');
requestAnimationFrame(gameLoop);
