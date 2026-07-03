import type { Profile, ServerMsg } from "@splash/shared";
import { NetClient } from "./net.js";
import { AudioManager } from "./audio.js";
import { Renderer } from "./render/sprites.js";
import { GameScreen } from "./screens/game.js";
import { TitleScreen } from "./screens/title.js";
import { MenuScreen } from "./screens/menu.js";
import { QueueScreen } from "./screens/queue.js";
import { BrowserScreen } from "./screens/browser.js";
import { LobbyScreen } from "./screens/lobby.js";
import { ResultsScreen } from "./screens/results.js";
import { LeaderboardScreen } from "./screens/leaderboard.js";
import { LockerScreen } from "./screens/locker.js";
import { SettingsScreen } from "./screens/settings.js";
import { TutorialScreen } from "./screens/tutorial.js";

export const WIDTH = 256;
export const HEIGHT = 224;
export const SCALE = 3;

export type Screen = {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  onKey?(e: KeyboardEvent, down: boolean): void;
  onMouse?(x: number, y: number, down: boolean): void;
};

export class App {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  net: NetClient;
  audio: AudioManager;
  renderer: Renderer;
  screen: Screen;
  keys: Record<string, boolean> = {};
  profile?: Profile;
  lastScreen?: string;
  savedScreens: Partial<Record<string, Screen>> = {};

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.style.width = `${WIDTH * SCALE}px`;
    this.canvas.style.height = `${HEIGHT * SCALE}px`;
    document.getElementById("app")!.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;

    this.audio = new AudioManager();
    this.net = new NetClient(this.onMessage.bind(this));
    this.renderer = new Renderer();
    this.screen = new TitleScreen(this);

    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (e.code === "KeyM") this.audio.toggleMute();
      this.screen.onKey?.(e, true);
    });
    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
      this.screen.onKey?.(e, false);
    });
    this.canvas.addEventListener("mousedown", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / SCALE;
      const y = (e.clientY - rect.top) / SCALE;
      this.screen.onMouse?.(x, y, true);
    });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  private loop() {
    const dt = 1 / 60;
    this.screen.update(dt);
    this.ctx.fillStyle = "#0f172a";
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    this.screen.draw(this.ctx);
    requestAnimationFrame(this.loop);
  }

  onMessage(msg: ServerMsg) {
    if (msg.type === "welcome") {
      this.profile = msg.profile;
      localStorage.setItem("splash_token", msg.token);
      if (!localStorage.getItem("splash_tutorial_done")) {
        this.setScreen("tutorial");
      } else {
        this.setScreen("menu");
      }
    }
    if (msg.type === "profile_update") {
      this.profile = msg.profile;
    }
    if (this.screen instanceof GameScreen || (this.screen as any).onMessage) {
      (this.screen as any).onMessage?.(msg);
    }
    if (this.screen instanceof LobbyScreen) {
      this.screen.onMessage(msg);
    }
    if (this.screen instanceof QueueScreen) {
      this.screen.onMessage(msg);
    }
    if (this.screen instanceof BrowserScreen) {
      this.screen.onMessage(msg);
    }
  }

  setScreen(name: string, data?: any) {
    this.lastScreen = name;
    this.audio.playTune(name);
    switch (name) {
      case "title":
        this.screen = new TitleScreen(this);
        break;
      case "tutorial":
        this.screen = new TutorialScreen(this);
        break;
      case "menu":
        this.screen = new MenuScreen(this);
        break;
      case "queue":
        this.screen = new QueueScreen(this, data);
        break;
      case "browser":
        this.screen = new BrowserScreen(this);
        break;
      case "lobby":
        this.screen = new LobbyScreen(this, data);
        break;
      case "game":
        this.screen = new GameScreen(this, data);
        break;
      case "results":
        this.screen = new ResultsScreen(this, data);
        break;
      case "leaderboard":
        this.screen = new LeaderboardScreen(this, data);
        break;
      case "locker":
        this.screen = new LockerScreen(this);
        break;
      case "settings":
        this.screen = new SettingsScreen(this);
        break;
      default:
        this.screen = new MenuScreen(this);
    }
  }
}

new App();
