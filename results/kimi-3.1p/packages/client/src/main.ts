import "./style.css";
import { CONFIG } from "@splash/shared";
import type {
  ClientMessage,
  Direction,
  MatchConfig,
  PlayerDescriptor,
  PlayerProfile,
  RoomListItem,
  ServerMessage
} from "@splash/shared";
import { SplashNet } from "./net.js";
import { Prediction } from "./prediction.js";
import { AudioManager } from "./audio.js";
import { loadSettings, saveSettings } from "./settings.js";
import { ERROR_STRINGS, STR } from "./strings.js";
import { ParticleSystem } from "./render/particles.js";
import { titleScreen } from "./screens/title.js";
import { menuScreen } from "./screens/menu.js";
import { browserScreen } from "./screens/browser.js";
import { lobbyScreen } from "./screens/lobby.js";
import { queueScreen } from "./screens/queue.js";
import { gameScreen, handleGameEvent, updateGame } from "./screens/game.js";
import { resultsScreen } from "./screens/results.js";
import { leaderboardScreen } from "./screens/leaderboard.js";
import { lockerScreen } from "./screens/locker.js";
import { settingsScreen } from "./screens/settings.js";
import { howToScreen } from "./screens/howto.js";
import { profileScreen } from "./screens/profile.js";
import { TutorialTracker } from "./screens/tutorial.js";
import type { Screen } from "./screens/types.js";
import { addDialogActions, dialogButton, openDialog, text } from "./screens/ui.js";
import type { BindingAction } from "./settings.js";

export type ScreenName = "title" | "menu" | "browser" | "lobby" | "queue" | "game" | "results" | "leaderboard" | "locker" | "settings" | "howto" | "profile";
type LobbyState = Extract<ServerMessage, { type: "lobby_state" }>;
type MatchEnd = Extract<ServerMessage, { type: "match_end" }>;

interface HitRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  action: () => void;
  disabled: boolean;
}

const SCREENS: Record<ScreenName, Screen> = {
  title: titleScreen,
  menu: menuScreen,
  browser: browserScreen,
  lobby: lobbyScreen,
  queue: queueScreen,
  game: gameScreen,
  results: resultsScreen,
  leaderboard: leaderboardScreen,
  locker: lockerScreen,
  settings: settingsScreen,
  howto: howToScreen,
  profile: profileScreen
};

export class App {
  readonly canvas: CanvasRenderingContext2D;
  readonly overlay: HTMLDivElement;
  readonly net: SplashNet;
  readonly settings = loadSettings();
  readonly audio = new AudioManager(this.settings);
  readonly prediction = new Prediction();
  readonly particles = new ParticleSystem();
  readonly tutorial = new TutorialTracker();
  readonly canvasElement: HTMLCanvasElement;
  profile: PlayerProfile | null = null;
  rooms: RoomListItem[] = [];
  lobby: LobbyState | null = null;
  matchConfig: MatchConfig | null = null;
  matchPlayers: PlayerDescriptor[] = [];
  matchRatings: Record<string, number | null> = {};
  localPlayerId = "";
  results: MatchEnd | null = null;
  resultsBaseXp = 0;
  queueMode: "duel" | "ffa" | null = null;
  queueJoinedAt = 0;
  queueSearchRange: number = CONFIG.MATCHMAKING.INITIAL_RANGE;
  queueEta: number = CONFIG.MATCHMAKING.ETA_SECONDS;
  queuePlayers = 0;
  feed: { text: string; until: number; color: string }[] = [];
  pointerX = -100;
  pointerY = -100;
  profileViewId = "";
  profileReturn: ScreenName = "menu";
  settingsReturn: ScreenName = "title";
  currentScreen: ScreenName = "title";
  private hitRegions: HitRegion[] = [];
  private directionCodes: string[] = [];
  private balloonQueued = false;
  private toastTimer = 0;
  private lastFrame = performance.now();
  private frames = 0;
  private fps = 0;
  private fpsAt = performance.now();
  private readonly dev = new URLSearchParams(location.search).has("dev");
  private readonly devElement: HTMLDivElement;

  constructor() {
    this.canvasElement = document.querySelector<HTMLCanvasElement>("#game")!;
    const context = this.canvasElement.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.canvas = context;
    this.canvas.imageSmoothingEnabled = false;
    this.overlay = document.querySelector<HTMLDivElement>("#overlay")!;
    this.devElement = document.querySelector<HTMLDivElement>("#dev")!;
    if (this.dev) this.devElement.style.display = "block";
    this.net = new SplashNet((message) => this.handleMessage(message), (connected) => {
      if (!connected) this.toastMessage(STR.connectionLost);
    });
    this.bindEvents();
    this.resize();
    SCREENS.title.enter?.(this);
    this.net.connect();
    requestAnimationFrame((time) => this.frame(time));
  }

  addHitRegion(region: HitRegion): void {
    this.hitRegions.push(region);
  }

  closeDialog(): void {
    this.overlay.replaceChildren();
  }

  go(name: ScreenName): void {
    if (name === "settings" && this.currentScreen !== "settings") this.settingsReturn = this.currentScreen;
    if (name === this.currentScreen) return;
    this.closeDialog();
    SCREENS[this.currentScreen].exit?.(this);
    this.currentScreen = name;
    SCREENS[name].enter?.(this);
  }

  startTutorial(): void {
    if (!this.profile) return this.toastMessage(STR.waiting);
    this.tutorial.reset();
    this.results = null;
    this.net.send({ type: "tutorial_start" });
    this.go("game");
  }

  joinRoom(code: string): void {
    this.closeDialog();
    this.net.send({ type: "join_room", code: code.toUpperCase() });
  }

  leaveRoom(): void {
    this.net.send({ type: "leave_room" });
    sessionStorage.removeItem("splash-room-code");
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    this.lobby = null;
    this.results = null;
    this.matchConfig = null;
    this.prediction.reset();
    this.go("menu");
  }

  continueAfterResults(): void {
    if (this.matchConfig?.ranked || this.matchConfig?.tutorial) this.leaveRoom();
    else this.go("lobby");
  }

  openProfile(playerId: string): void {
    this.profileViewId = playerId;
    this.profileReturn = this.currentScreen === "profile" ? "menu" : this.currentScreen;
    this.go("profile");
  }

  openPause(): void {
    const dialog = openDialog(this, STR.paused);
    if (this.matchConfig?.ranked) {
      const warning = document.createElement("p");
      warning.className = "warning";
      warning.textContent = STR.leaveWarning;
      dialog.append(warning);
    }
    addDialogActions(dialog,
      dialogButton(this.matchConfig?.tutorial ? STR.skipTutorial : STR.leave, () => this.leaveRoom(), "danger"),
      dialogButton(STR.settings, () => this.go("settings"), "secondary"),
      dialogButton(STR.resume, () => this.closeDialog())
    );
  }

  toastMessage(message: string): void {
    const toast = document.querySelector<HTMLDivElement>("#toast")!;
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
      toast.textContent = "";
    }, 3500);
  }

  currentDirection(): Direction {
    for (let index = this.directionCodes.length - 1; index >= 0; index -= 1) {
      const direction = this.directionForCode(this.directionCodes[index]);
      if (direction) return direction;
    }
    return "none";
  }

  consumeBalloon(): boolean {
    const queued = this.balloonQueued;
    this.balloonQueued = false;
    return queued;
  }

  clearInputs(): void {
    this.directionCodes = [];
    this.balloonQueued = false;
  }

  private directionForCode(code: string): Direction | null {
    if (code === this.settings.bindings.up || code === "ArrowUp") return "up";
    if (code === this.settings.bindings.down || code === "ArrowDown") return "down";
    if (code === this.settings.bindings.left || code === "ArrowLeft") return "left";
    if (code === this.settings.bindings.right || code === "ArrowRight") return "right";
    return null;
  }

  private isBalloonCode(code: string): boolean {
    return code === this.settings.bindings.balloon || (this.settings.bindings.balloon !== "KeyE" && code === "KeyE");
  }

  private bindEvents(): void {
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea") || target?.isContentEditable) return;
      this.audio.resume();
      if (this.overlay.childElementCount > 0) {
        if (event.code === "Escape") this.closeDialog();
        return;
      }
      if (event.code === "KeyM") {
        this.settings.muted = !this.settings.muted;
        saveSettings(this.settings);
        event.preventDefault();
        return;
      }
      const direction = this.directionForCode(event.code);
      if (direction && this.currentScreen === "game") {
        if (!this.directionCodes.includes(event.code)) this.directionCodes.push(event.code);
        event.preventDefault();
      }
      if (this.isBalloonCode(event.code) && this.currentScreen === "game") {
        if (!event.repeat) this.balloonQueued = true;
        event.preventDefault();
      }
      const handled = SCREENS[this.currentScreen].key?.(this, event.code) ?? false;
      if (handled) event.preventDefault();
    });
    window.addEventListener("keyup", (event) => {
      this.directionCodes = this.directionCodes.filter((code) => code !== event.code);
    });
    window.addEventListener("blur", () => {
      this.clearInputs();
      this.audio.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clearInputs();
        this.audio.pause();
      }
      this.lastFrame = performance.now();
    });
    this.canvasElement.addEventListener("pointermove", (event) => this.updatePointer(event));
    this.canvasElement.addEventListener("pointerleave", () => {
      this.pointerX = -100;
      this.pointerY = -100;
    });
    this.canvasElement.addEventListener("pointerdown", (event) => {
      this.audio.resume();
      this.updatePointer(event);
      for (let index = this.hitRegions.length - 1; index >= 0; index -= 1) {
        const region = this.hitRegions[index];
        if (region.disabled || this.pointerX < region.x || this.pointerX > region.x + region.width || this.pointerY < region.y || this.pointerY > region.y + region.height) continue;
        this.audio.play("click");
        region.action();
        event.preventDefault();
        break;
      }
    });
  }

  private updatePointer(event: PointerEvent): void {
    const bounds = this.canvasElement.getBoundingClientRect();
    this.pointerX = (event.clientX - bounds.left) * 256 / bounds.width;
    this.pointerY = (event.clientY - bounds.top) * 224 / bounds.height;
  }

  private resize(): void {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / 256, window.innerHeight / 224)));
    this.canvasElement.style.width = `${256 * scale}px`;
    this.canvasElement.style.height = `${224 * scale}px`;
    const shell = document.querySelector<HTMLElement>("#shell")!;
    shell.style.width = `${256 * scale}px`;
    shell.style.height = `${224 * scale}px`;
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.profile = message.profile;
      this.localPlayerId = message.sessionId;
      localStorage.setItem("splash-device-token", message.token);
      this.net.send({ type: "room_list_request", filter: "all" });
      const hashCode = location.hash.match(/^#\/room\/([A-Z0-9]{6})$/)?.[1];
      const roomCode = hashCode ?? sessionStorage.getItem("splash-room-code");
      if (roomCode) this.net.send({ type: "join_room", code: roomCode });
      return;
    }
    if (message.type === "profile_update") {
      this.profile = message.profile;
      return;
    }
    if (message.type === "error") {
      this.toastMessage(ERROR_STRINGS[message.code] ?? message.msg ?? STR.unknownError);
      if (message.code === "ROOM_NOT_FOUND") {
        sessionStorage.removeItem("splash-room-code");
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      }
      if (message.code === "NICKNAME_REQUIRED") this.go("settings");
      return;
    }
    if (message.type === "queue_status") {
      this.queueMode = message.mode;
      this.queueEta = message.eta;
      this.queueSearchRange = message.searchRange;
      this.queuePlayers = message.players;
      if (this.currentScreen !== "queue" && this.currentScreen !== "game" && this.currentScreen !== "results") this.go("queue");
      return;
    }
    if (message.type === "match_found") {
      this.queueMode = null;
      sessionStorage.setItem("splash-room-code", message.code);
      this.go("game");
      return;
    }
    if (message.type === "room_created") {
      sessionStorage.setItem("splash-room-code", message.code);
      history.replaceState(null, "", `${location.pathname}${location.search}#/room/${message.code}`);
      return;
    }
    if (message.type === "room_list") {
      this.rooms = message.rooms;
      return;
    }
    if (message.type === "lobby_state") {
      this.lobby = message;
      this.localPlayerId = message.you;
      sessionStorage.setItem("splash-room-code", message.code);
      if (!message.inMatch && ["title", "menu", "browser", "lobby"].includes(this.currentScreen)) this.go("lobby");
      if (message.inMatch && !["game", "results"].includes(this.currentScreen)) this.go("game");
      return;
    }
    if (message.type === "match_start") {
      this.matchConfig = message.config;
      this.matchPlayers = message.players;
      this.matchRatings = message.ratings;
      this.localPlayerId = message.localPlayerId;
      this.results = null;
      this.queueMode = null;
      this.go("game");
      return;
    }
    if (message.type === "round_start") {
      if (this.matchConfig) this.prediction.startRound(message, this.matchConfig, this.matchPlayers, this.localPlayerId);
      return;
    }
    if (message.type === "snapshot") {
      this.prediction.applySnapshot(message.data, message.serverTime);
      return;
    }
    if (message.type === "event") {
      this.prediction.applyEvent(message.event);
      handleGameEvent(this, message.event);
      return;
    }
    if (message.type === "round_end") return;
    if (message.type === "match_end") {
      const ownXp = message.xp[this.localPlayerId] ?? 0;
      this.resultsBaseXp = Math.max(0, (this.profile?.xp ?? ownXp) - ownXp);
      this.results = message;
      this.go("results");
    }
  }

  private frame(time: number): void {
    requestAnimationFrame((next) => this.frame(next));
    const delta = Math.min(50, time - this.lastFrame);
    this.lastFrame = time;
    if (this.currentScreen === "game") updateGame(this, time);
    else this.particles.update(delta / 1000);
    this.hitRegions = [];
    this.canvas.clearRect(0, 0, 256, 224);
    SCREENS[this.currentScreen].render(this, time);
    if (this.currentScreen === "results") this.particles.render(this.canvas);
    if (!this.net.connected) text(this, STR.connectionLost, 128, 216, "#ff858d", 6, "center");
    if (this.dev) {
      this.frames += 1;
      if (time - this.fpsAt >= 500) {
        this.fps = Math.round(this.frames * 1000 / (time - this.fpsAt));
        this.frames = 0;
        this.fpsAt = time;
      }
      const state = this.prediction.state;
      const entities = state ? state.players.length + state.balloons.length + state.splashes.length + state.powerups.length : 0;
      this.devElement.textContent = `${this.fps} fps\n${delta.toFixed(1)} ms\n${entities} entities\n${this.currentScreen}`;
    }
  }
}

new App();
