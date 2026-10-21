import type { Mode, PlayerProfile, RoomInfo, RoomState, ServerMessage } from '@splash-critters/shared';
import { audio } from './audio.js';
import { NetClient } from './net.js';
import {
  loadSettings,
  saveSettings,
  saveToken,
  type AppState,
  type ScreenName,
  type Settings,
} from './state.js';
import { GameScreen } from './screens/game.js';
import { TitleScreen } from './screens/title.js';
import { MenuScreen } from './screens/menu.js';
import { BrowserScreen } from './screens/browser.js';
import { LobbyScreen } from './screens/lobby.js';
import { QueueScreen } from './screens/queue.js';
import { ResultsScreen } from './screens/results.js';
import { LeaderboardScreen } from './screens/leaderboard.js';
import { LockerScreen } from './screens/locker.js';
import { SettingsScreen } from './screens/settings.js';
import { TutorialScreen } from './screens/tutorial.js';
import { HelpScreen } from './screens/help.js';

export interface Screen {
  show(app: App): void;
  hide(): void;
  update(dt: number): void;
  render?(ctx: CanvasRenderingContext2D, dt: number): void;
}

export class App {
  state: AppState;
  net = new NetClient();
  overlay: HTMLElement;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  game: GameScreen;
  room: RoomState | null = null;
  lastMatchEnd: Extract<ServerMessage, { t: 'match_end' }> | null = null;
  frame = 0;
  tutorialPending = false;

  private screens = new Map<ScreenName, Screen>();
  private current: ScreenName = 'title';
  private currentScreen: Screen | null = null;
  private browser: BrowserScreen;
  private lobby: LobbyScreen;
  private lastFrame = performance.now();

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.canvas = canvas;
    this.overlay = overlay;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d is not available');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.state = {
      screen: 'title',
      profile: null,
      playerId: null,
      settings: loadSettings(),
      queue: null,
      toast: null,
      latencyFlag: loadSettings().latency,
    };

    this.browser = new BrowserScreen();
    this.lobby = new LobbyScreen();
    this.game = new GameScreen();

    this.register('title', new TitleScreen());
    this.register('menu', new MenuScreen());
    this.register('browser', this.browser);
    this.register('lobby', this.lobby);
    this.register('queue', new QueueScreen());
    this.register('results', new ResultsScreen());
    this.register('leaderboard', new LeaderboardScreen());
    this.register('locker', new LockerScreen());
    this.register('settings', new SettingsScreen());
    this.register('tutorial', new TutorialScreen());
    this.register('help', new HelpScreen());
    this.register('game', this.game);

    this.game.attach(this);
    audio.setVolumes(
      this.state.settings.sfxVolume,
      this.state.settings.musicVolume,
      this.state.settings.muted,
    );

    this.net.onStatusChange = (status) => {
      if (status === 'offline') this.toast('connection lost - reconnecting');
    };
    this.wireNet();
    this.go('title');
  }

  private register(name: ScreenName, screen: Screen): void {
    this.screens.set(name, screen);
  }

  private wireNet(): void {
    this.net.on('welcome', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'welcome' }>;
      this.state.profile = msg.profile;
      this.state.playerId = msg.playerId;
      if (msg.token) saveToken(msg.token);
      // refresh the current screen so the profile shows up
      if (this.current === 'title' || this.current === 'menu') this.go(this.current);
    });
    this.net.on('profile', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'profile' }>;
      this.state.profile = msg.profile;
    });
    this.net.on('error', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'error' }>;
      this.toast(msg.msg);
      audio.play('error');
    });
    this.net.on('queue_status', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'queue_status' }>;
      this.state.queue = {
        mode: msg.mode,
        elapsedMs: msg.elapsedMs,
        searchRange: msg.searchRange,
        queued: msg.queued,
        eta: msg.eta,
      };
    });
    this.net.on('match_found', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'match_found' }>;
      this.toast('match found!');
      this.go('lobby');
    });
    this.net.on('room_list', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'room_list' }>;
      this.browser.setRooms(msg.rooms);
    });
    this.net.on('room_created', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'room_created' }>;
      this.room = msg.room;
      if (this.tutorialPending) {
        this.tutorialPending = false;
        this.send({ t: 'set_slot', slot: 1, kind: 'bot', difficulty: 'easy' });
        this.send({ t: 'start_match' });
        return;
      }
      this.go('lobby');
    });
    this.net.on('lobby_state', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'lobby_state' }>;
      this.room = msg.room;
      this.lobby.setRoom(msg.room);
      if (msg.room.phase === 'lobby' && this.current === 'results') this.go('lobby');
    });
    this.net.on('match_start', (message) => {
      this.game.onMatchStart(message as Extract<ServerMessage, { t: 'match_start' }>);
      this.go('game');
    });
    this.net.on('round_start', (message) => {
      this.game.onRoundStart(message as Extract<ServerMessage, { t: 'round_start' }>);
      this.go('game');
    });
    this.net.on('snapshot', (message) => {
      this.game.onSnapshot((message as Extract<ServerMessage, { t: 'snapshot' }>).snapshot);
    });
    this.net.on('event', (message) => {
      this.game.onEvent((message as Extract<ServerMessage, { t: 'event' }>).event);
    });
    this.net.on('round_end', (message) => {
      this.game.onRoundEnd(message as Extract<ServerMessage, { t: 'round_end' }>);
    });
    this.net.on('match_end', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'match_end' }>;
      this.lastMatchEnd = msg;
      this.game.onMatchEnd(msg);
    });
    this.net.on('ping', (message) => {
      const msg = message as Extract<ServerMessage, { t: 'ping' }>;
      this.game.onPing(msg.ts, msg.echo);
    });
  }

  go(name: ScreenName): void {
    if (this.currentScreen && this.currentScreen !== this.screens.get(name)) {
      this.currentScreen.hide();
    }
    const screen = this.screens.get(name);
    this.current = name;
    this.state.screen = name;
    if (screen) {
      screen.show(this);
      this.currentScreen = screen;
    }
  }

  get screenName(): ScreenName {
    return this.current;
  }

  toast(message: string, seconds = 2.6): void {
    this.state.toast = { message, until: performance.now() + seconds * 1000 };
  }

  updateSettings(patch: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    saveSettings(this.state.settings);
    audio.setVolumes(
      this.state.settings.sfxVolume,
      this.state.settings.musicVolume,
      this.state.settings.muted,
    );
  }

  profile(): PlayerProfile | null {
    return this.state.profile;
  }

  setProfile(profile: PlayerProfile): void {
    this.state.profile = profile;
  }

  startLoop(): void {
    const loop = (now: number): void => {
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame += 1;
      this.currentScreen?.update(dt);
      this.renderOverlay();
      this.currentScreen?.render?.(this.ctx, dt);
      if (this.game.active && (this.currentScreen as unknown) !== (this.game as unknown)) {
        this.game.update(dt);
        this.game.render(this.ctx, dt);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private renderOverlay(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    if (!this.game.active) {
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.state.toast) {
      if (this.state.toast.until < performance.now()) {
        this.state.toast = null;
        this.toastNode?.remove();
        this.toastNode = null;
      } else {
        this.renderToast();
      }
    }
  }

  private toastNode: HTMLDivElement | null = null;

  private renderToast(): void {
    if (!this.toastNode) {
      this.toastNode = document.createElement('div');
      this.toastNode.className = 'toast';
      this.overlay.appendChild(this.toastNode);
    }
    this.toastNode.textContent = this.state.toast?.message ?? '';
  }

  send(message: Parameters<NetClient['send']>[0]): void {
    this.net.send(message);
  }

  queueRanked(mode: Mode): void {
    this.state.queue = { mode, elapsedMs: 0, searchRange: 100, queued: 1, eta: 10 };
    this.net.send({ t: 'queue_join', mode });
    this.go('queue');
  }

  leaveQueue(): void {
    this.net.send({ t: 'queue_leave' });
    this.state.queue = null;
    this.go('menu');
  }

  setRooms(rooms: RoomInfo[]): void {
    this.browser.setRooms(rooms);
  }
}
