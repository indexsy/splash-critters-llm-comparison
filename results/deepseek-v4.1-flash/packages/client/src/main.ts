import type {
  GameMode,
  LobbyView,
  MatchConfig,
  PlayerProfile,
  RoomSummary,
  ServerMessage,
} from "@splash/shared";
import { AudioManager } from "./audio.js";
import { NetClient, type ConnectionStatus } from "./net.js";
import { SettingsStore } from "./settings.js";
import { COLORS, Screen, contains, drawPanel } from "./ui.js";
import { drawText, drawTextCentered, textWidth } from "./render/font.js";
import { TitleScreen } from "./screens/title.js";
import { MenuScreen } from "./screens/menu.js";
import { QueueScreen } from "./screens/queue.js";
import { BrowserScreen } from "./screens/browser.js";
import { LobbyScreen } from "./screens/lobby.js";
import { LeaderboardScreen } from "./screens/leaderboard.js";
import { LockerScreen } from "./screens/locker.js";
import { SettingsScreen } from "./screens/settings.js";
import { TutorialScreen } from "./screens/tutorial.js";
import { GameScreen } from "./screens/game.js";
import { ResultsScreen } from "./screens/results.js";

type QueueStatusMessage = Extract<ServerMessage, { t: "queue_status" }>;

const TOKEN_KEY = "splash:token";

export class App {
  readonly settings = new SettingsStore();
  readonly audio = new AudioManager(this.settings);
  readonly net: NetClient;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  playerId = "";
  profile: PlayerProfile | null = null;
  connection: ConnectionStatus = "idle";
  rooms: RoomSummary[] = [];
  lobby: LobbyView | null = null;
  queueStatus: QueueStatusMessage | null = null;
  rematchVotes = 0;
  rematchNeeded = 2;
  rtt = 0;

  private current: Screen;
  private game: GameScreen | null = null;
  private pendingRoom: string | null = null;
  private heldKeys = new Set<string>();
  private toastMessage = "";
  private toastUntil = 0;
  private lastFrame = 0;
  private reconnectToastShown = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is not available");
    this.ctx = context;
    this.net = new NetClient({
      onStatus: (status) => this.handleStatus(status),
      onMessage: (message) => this.handleMessage(message),
      onOpen: () => {
        this.reconnectToastShown = false;
      },
    });
    this.pendingRoom = this.roomFromHash();
    this.current = new TitleScreen(this);
  }

  start(): void {
    this.fitCanvas();
    this.current.enter();
    this.bindEvents();
    this.net.lagMs = Math.max(0, this.settings.data.devLatency);
    this.net.connect(this.loadToken());
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.current.update(dt);
    this.ctx.imageSmoothingEnabled = false;
    this.current.render(this.ctx);
    this.renderOverlay();
    requestAnimationFrame(this.frame);
  };

  private bindEvents(): void {
    window.addEventListener("resize", () => this.fitCanvas());
    window.addEventListener("keydown", (event) => {
      this.audio.unlock();
      const bound = (["up", "down", "left", "right", "drop"] as const).some((action) =>
        this.settings.matches(action, event.code),
      );
      if (bound) {
        this.heldKeys.add(event.code);
        event.preventDefault();
      }
      if (this.current.onKeyDown(event)) {
        event.preventDefault();
      } else if (!event.repeat && event.code === "KeyM") {
        this.settings.set("muted", !this.settings.data.muted);
        this.audio.syncSettings();
        this.toast(this.settings.data.muted ? "AUDIO MUTED." : "AUDIO ON.");
        event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => {
      this.heldKeys.delete(event.code);
    });
    window.addEventListener("blur", () => {
      this.heldKeys.clear();
    });
    this.canvas.addEventListener("mousemove", (event) => {
      const point = this.pointer(event);
      this.canvas.style.cursor = this.current.cursorAt(point.x, point.y);
      this.current.onMouseMove(point.x, point.y);
    });
    this.canvas.addEventListener("mousedown", (event) => {
      this.audio.unlock();
      const point = this.pointer(event);
      if (event.button === 0) this.current.onClick(point.x, point.y);
      else if (event.button === 2) this.current.onRightClick(point.x, point.y);
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("hashchange", () => {
      const code = this.roomFromHash();
      if (!code) return;
      this.pendingRoom = code;
      if (this.profile?.tutorialDone && !this.lobby && !this.game) this.joinPendingRoom();
    });
  }

  private fitCanvas(): void {
    const scale = Math.max(1, Math.min(
      Math.floor(window.innerWidth / 256),
      Math.floor(window.innerHeight / 224),
    ));
    const fallback = Math.min(window.innerWidth / 256, window.innerHeight / 224);
    const use = scale >= 1 ? scale : fallback;
    this.canvas.style.width = `${Math.max(256, Math.floor(256 * use))}px`;
    this.canvas.style.height = `${Math.max(224, Math.floor(224 * use))}px`;
  }

  private pointer(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * 256),
      y: Math.floor(((event.clientY - rect.top) / rect.height) * 224),
    };
  }

  private loadToken(): string {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private storeToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      return;
    }
  }

  private roomFromHash(): string | null {
    const match = location.hash.match(/^#\/room\/([A-Za-z0-9]{3,12})$/u);
    return match?.[1]?.toUpperCase() ?? null;
  }

  private clearRoomHash(): void {
    if (location.hash.startsWith("#/room/")) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }

  private handleStatus(status: ConnectionStatus): void {
    const previous = this.connection;
    this.connection = status;
    if (status === "reconnecting" && !this.reconnectToastShown) {
      this.reconnectToastShown = true;
      this.toast("CONNECTION LOST. RECONNECTING...");
    }
    if (status === "open" && previous === "reconnecting") {
      this.toast("RECONNECTED.");
    }
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.t) {
      case "welcome": {
        this.playerId = message.playerId;
        this.profile = message.profile;
        if (message.token) this.storeToken(message.token);
        if (
          this.current instanceof TitleScreen &&
          this.pendingRoom &&
          message.profile.tutorialDone
        ) {
          this.joinPendingRoom();
        }
        return;
      }
      case "error": {
        this.toast(message.msg);
        if (
          message.code === "JOIN_FAILED" ||
          message.code === "QUEUE_ERROR" ||
          message.code === "NEED_NICKNAME" ||
          message.code === "CREATE_FAILED"
        ) {
          this.pendingRoom = null;
          if (!(this.current instanceof GameScreen)) this.showMenu();
        }
        return;
      }
      case "notice": {
        this.toast(message.msg);
        return;
      }
      case "profile_update": {
        const previousLevel = this.profile?.level ?? 0;
        this.profile = message.profile;
        if (message.profile.level > previousLevel) this.audio.levelUp();
        return;
      }
      case "queue_status": {
        this.queueStatus = message;
        return;
      }
      case "match_found": {
        this.toast("MATCH FOUND!");
        return;
      }
      case "room_list": {
        this.rooms = message.rooms;
        return;
      }
      case "room_created": {
        this.toast(`ROOM ${message.code} CREATED`);
        return;
      }
      case "lobby_state": {
        this.lobby = message.lobby;
        this.pendingRoom = null;
        if (this.current instanceof GameScreen) return;
        this.showLobby();
        return;
      }
      case "match_start": {
        this.showGame(message.config);
        return;
      }
      case "round_start": {
        this.game?.onRoundStart(message.data);
        return;
      }
      case "snapshot": {
        this.game?.onSnapshot(message);
        return;
      }
      case "event": {
        this.game?.onEvent(message);
        return;
      }
      case "emote": {
        this.game?.onEmote(message.playerId, message.id);
        return;
      }
      case "round_end": {
        this.game?.onRoundEnd(message.data);
        return;
      }
      case "match_end": {
        this.showResults(message.data);
        return;
      }
      case "rematch_status": {
        this.rematchVotes = message.votes;
        this.rematchNeeded = message.needed;
        return;
      }
      case "ping": {
        this.rtt = message.rtt;
        this.net.pong(message.sentAt);
        return;
      }
      default:
        return;
    }
  }

  showScreen(screen: Screen): void {
    if (this.current === screen) return;
    this.current.exit();
    this.current = screen;
    this.heldKeys.clear();
    screen.enter();
  }

  showTitle(): void {
    this.game = null;
    this.showScreen(new TitleScreen(this));
  }

  finishTitle(): void {
    if (this.pendingRoom) {
      this.joinPendingRoom();
      return;
    }
    this.showMenu();
  }

  afterTutorial(): void {
    if (this.pendingRoom) {
      this.joinPendingRoom();
      return;
    }
    this.showMenu();
  }

  showMenu(): void {
    this.clearRoomHash();
    this.pendingRoom = null;
    this.lobby = null;
    this.game = null;
    this.showScreen(new MenuScreen(this));
  }

  showQueue(mode: GameMode): void {
    this.showScreen(new QueueScreen(this, mode));
  }

  showBrowser(): void {
    this.lobby = null;
    this.showScreen(new BrowserScreen(this));
  }

  showLobby(): void {
    this.showScreen(new LobbyScreen(this));
  }

  showLeaderboard(): void {
    this.showScreen(new LeaderboardScreen(this));
  }

  showLocker(): void {
    this.showScreen(new LockerScreen(this));
  }

  showSettings(): void {
    this.showScreen(new SettingsScreen(this));
  }

  showTutorial(): void {
    this.showScreen(new TutorialScreen(this));
  }

  showGame(config: MatchConfig): void {
    this.lobby = null;
    this.queueStatus = null;
    this.rematchVotes = 0;
    this.rematchNeeded = 2;
    const game = new GameScreen(this, config);
    this.game = game;
    this.showScreen(game);
  }

  showResults(data: Extract<ServerMessage, { t: "match_end" }>["data"]): void {
    this.game = null;
    this.rematchVotes = 0;
    this.showScreen(new ResultsScreen(this, data));
  }

  private joinPendingRoom(): void {
    const code = this.pendingRoom;
    if (!code) {
      this.showMenu();
      return;
    }
    if (this.connection !== "open") {
      this.toast("NOT CONNECTED YET. TRY AGAIN IN A MOMENT.");
      return;
    }
    this.toast(`JOINING ROOM ${code}...`);
    this.pendingRoom = null;
    this.net.joinRoom(code);
  }

  toast(message: string, durationMs = 2300): void {
    this.toastMessage = message.toUpperCase().slice(0, 54);
    this.toastUntil = performance.now() + durationMs;
  }

  isActionDown(action: "up" | "down" | "left" | "right" | "drop"): boolean {
    return this.settings.data.bindings[action].some((code) => this.heldKeys.has(code));
  }

  private renderOverlay(): void {
    if (performance.now() >= this.toastUntil) return;
    const text = this.toastMessage;
    const width = Math.min(244, Math.max(104, textWidth(text) + 16));
    const x = Math.floor((256 - width) / 2);
    drawPanel(this.ctx, x, 205, width, 17, "rgba(4, 20, 29, 0.96)", "#3d7a87");
    drawTextCentered(this.ctx, text, 128, 210, COLORS.foam);
  }
}

const canvas = document.getElementById("game");
if (canvas instanceof HTMLCanvasElement) {
  const app = new App(canvas);
  app.start();
  if (import.meta.env.DEV) {
    (window as Window & { __splash?: App }).__splash = app;
  }
}
