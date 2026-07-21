import type { ClientMessage, Profile, ServerMessage } from "@splash/shared";
import { CONFIG } from "@splash/shared";
import "./styles.css";
import { Net, type ConnectionStatus } from "./net.js";
import { AudioEngine } from "./audio.js";
import { Particles } from "./render/particles.js";
import { Hud } from "./render/hud.js";
import { STAGE_H, STAGE_W, paletteFor } from "./render/sprites.js";
import { el, clear, toastArea, type ClassValue, cx } from "./ui.js";
import { CosmeticManager, SettingsManager, isTutorialDone } from "./screens/state.js";
import { createTitleScreen } from "./screens/title.js";
import { createTutorialScreen } from "./screens/tutorial.js";
import { createMenuScreen } from "./screens/menu.js";
import { createBrowserScreen } from "./screens/browser.js";
import { createLobbyScreen } from "./screens/lobby.js";
import { createQueueScreen } from "./screens/queue.js";
import { createGameScreen } from "./screens/game.js";
import { createResultsScreen } from "./screens/results.js";
import { createLeaderboardScreen } from "./screens/leaderboard.js";
import { createLockerScreen } from "./screens/locker.js";
import { createSettingsScreen } from "./screens/settings.js";

export type ScreenId =
  | "title" | "tutorial" | "menu" | "browser" | "lobby" | "queue"
  | "game" | "results" | "leaderboard" | "locker" | "settings";

export interface ScreenParams { [k: string]: unknown }

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  t: number;
  dt: number;
  shake: number;
}

export interface AppCtx {
  root: HTMLElement;
  net: Net;
  audio: AudioEngine;
  settings: SettingsManager;
  cosmetics: CosmeticManager;
  particles: Particles;
  hud: Hud;
  go: (id: ScreenId, params?: ScreenParams) => void;
  toast: (msg: string, kind?: "info" | "good" | "bad") => void;
  announce: (text: string, color?: string, sub?: string, ms?: number) => void;
  shake: (amount: number) => void;
  flash: (color: string, alpha?: number) => void;
  profile: () => Profile | null;
  isHost: () => boolean;
  lobbyCode: () => string | null;
  pushKill: (text: string, color?: string) => void;
}

export interface ScreenHandle {
  root: HTMLElement;
  onTick?(dt: number, now: number): void;
  onRender?(rc: RenderCtx): void;
  onKey?(ev: KeyboardEvent, down: boolean): boolean;
  onResize?(w: number, h: number): void;
  onMessage?(msg: ServerMessage): void;
  unmount(): void;
}

export interface Screen {
  id: ScreenId;
  mount(ctx: AppCtx, params: ScreenParams): ScreenHandle;
}

class App implements AppCtx {
  root: HTMLElement;
  net = new Net("/ws");
  audio = new AudioEngine();
  settings = new SettingsManager();
  cosmetics = new CosmeticManager();
  particles = new Particles();
  hud = new Hud();

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private stageWrap!: HTMLElement;
  private screenLayer!: HTMLElement;
  private railStatus!: HTMLElement;
  private railPing!: HTMLElement;
  private bannerStatus!: HTMLElement;
  private footer!: HTMLElement;
  private emoteBar!: HTMLElement;

  private screen: ScreenHandle | null = null;
  private current: ScreenId | null = null;
  private registry: Record<ScreenId, Screen>;
  private raf = 0;
  private lastT = performance.now();
  private inputAcc = 0;
  private pingValue = 0;
  private shakeAmt = 0;
  private flashColor = "transparent";
  private flashAlpha = 0;
  private ambientT = 0;
  private lobbyCodeCache: string | null = null;
  private isHostCache = false;
  private offNet: () => void;
  private toastCtl: { show: (msg: string, kind?: "info" | "good" | "bad") => void };

  constructor() {
    this.root = document.getElementById("app") as HTMLElement;
    clear(this.root);
    const shell = this.buildShell();
    this.root.append(shell);
    this.canvas.width = STAGE_W;
    this.canvas.height = STAGE_H;
    this.canvas.style.width = `${STAGE_W}px`;
    this.canvas.style.height = `${STAGE_H}px`;
    this.fitStage();
    window.addEventListener("resize", () => this.fitStage());

    this.registry = {
      title: createTitleScreen(),
      tutorial: createTutorialScreen(),
      menu: createMenuScreen(),
      browser: createBrowserScreen(),
      lobby: createLobbyScreen(),
      queue: createQueueScreen(),
      game: createGameScreen(),
      results: createResultsScreen(),
      leaderboard: createLeaderboardScreen(),
      locker: createLockerScreen(),
      settings: createSettingsScreen()
    };

    this.audio.apply(this.settings.get());
    this.settings.subscribe((s) => {
      this.audio.apply({ master: s.master, sfx: s.sfx, music: s.music, muted: s.muted });
      this.canvas.style.filter = s.reducedShake ? "none" : "";
    });

    this.offNet = this.net.add({
      onStatus: (s) => this.onStatus(s),
      onPing: (rtt) => { this.pingValue = rtt; },
      onWelcome: () => { this.isHostCache = false; },
      onLobby: (l) => {
        this.lobbyCodeCache = l.code;
        const me = this.net.profile;
        this.isHostCache = !!me && l.hostId === me.id;
      },
      onMessage: (msg) => this.onMessage(msg)
    });

    this.toastCtl = toastArea(this.root);

    this.net.connect();

    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.audio.resume();
    });
    this.root.addEventListener("pointerdown", () => this.audio.resume(), { once: false });

    this.loop(performance.now());
  }

  private buildShell(): HTMLElement {
    this.canvas = el("canvas", { class: ["sc-stage-canvas"], attrs: { width: String(STAGE_W), height: String(STAGE_H) } }) as HTMLCanvasElement;
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;

    this.screenLayer = el("div", { class: ["sc-screen"] });
    this.stageWrap = el("div", { class: ["sc-stage-wrap"] }, [
      el("div", { class: ["sc-stage"] }, [this.canvas]),
      this.screenLayer
    ]);

    this.bannerStatus = el("span", { class: ["sc-chip", "warn"], attrs: { id: "sc-conn" } }, [
      el("span", { class: ["dot"] }),
      el("span", { text: "CONNECTING" })
    ]);

    this.railStatus = el("div", { class: ["sc-rail-status"] }, [
      el("span", { text: "PING" }),
      this.railPing = el("span", { class: ["ping"], text: "—" }),
      el("span", { text: "v1.0" })
    ]);

    this.emoteBar = el("div", { class: ["sc-emote-bar", "sc-hide"] });
    const emotes: Array<[string, number]> = [["!", 1], ["?", 2], ["♥", 3], ["★", 4]];
    for (const [label, id] of emotes) {
      const b = el("button", { text: label, attrs: { "aria-label": `emote ${id}` }, on: { click: () => this.net.send({ type: "emote", id: id as 1 | 2 | 3 | 4 }) } }) as HTMLButtonElement;
      this.emoteBar.append(b);
    }

    this.footer = el("div", { class: ["sc-footer"] }, [
      el("span", { text: "© SPLASH CRITTERS" }),
      el("span", { class: ["spacer"] }),
      this.emoteBar,
      el("button", { text: "MUTE [M]", on: { click: () => this.toggleMute() } }),
      el("button", { text: "SETTINGS", on: { click: () => this.go("settings") } })
    ]);

    const rail = el("div", { class: ["sc-rail"] }, [
      el("div", { class: ["sc-rail-title"] }, [
        document.createTextNode("SPLASH "),
        el("em", { text: "CRITTERS" })
      ]),
      this.railStatus
    ]);

    const banner = el("div", { class: ["sc-banner"] }, [
      el("div", { class: ["sc-logo"] }, [
        document.createTextNode("SPLASH CRITTERS"),
        el("small", { text: "TINY WATER ARENA" })
      ]),
      el("div", { class: ["sc-banner-spacer"] }),
      this.bannerStatus
    ]);

    const shell = el("div", { class: ["sc-shell"] }, [rail, this.stageWrap]);
    return el("div", {}, [banner, shell, this.footer]);
  }

  private fitStage(): void {
    const wrap = this.stageWrap.getBoundingClientRect();
    const padding = 16;
    const availW = Math.max(160, wrap.width - padding);
    const availH = Math.max(140, wrap.height - padding);
    const scale = Math.max(1, Math.floor(Math.min(availW / STAGE_W, availH / STAGE_H)));
    this.canvas.style.width = `${STAGE_W * scale}px`;
    this.canvas.style.height = `${STAGE_H * scale}px`;
    if (this.screen?.onResize) this.screen.onResize(STAGE_W * scale, STAGE_H * scale);
  }

  private toggleMute(): void {
    const s = this.settings.get();
    this.settings.update({ muted: !s.muted });
    this.toast(s.muted ? "UNMUTED" : "MUTED");
  }

  private onStatus(status: ConnectionStatus): void {
    const classes: ClassValue[] = ["sc-chip"];
    let label = status.toUpperCase();
    let dot = "warn";
    if (status === "online") { classes.push("ok"); dot = "ok"; label = "ONLINE"; }
    else if (status === "offline") { classes.push(undefined); dot = ""; label = "OFFLINE"; }
    else if (status === "connecting") { classes.push("warn"); }
    void dot;
    clear(this.bannerStatus);
    this.bannerStatus.append(el("span", { class: ["dot"] }), el("span", { text: label }));
    this.bannerStatus.className = cx(...classes);
    if (status === "online") this.bannerStatus.classList.add("ok");
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        this.cosmetics.set({ animal: msg.profile.selectedAnimal, hat: msg.profile.selectedHat });
        if (this.current === null) {
          const roomCode = window.location.hash.match(/^#\/room\/([A-Z2-9]{6})$/i)?.[1]?.toUpperCase();
          if (roomCode) {
            this.net.send({ type: "join_room", code: roomCode });
            this.go("lobby");
          } else {
            this.go("title");
          }
        }
        break;
      case "match_found":
        this.toast(`MATCH FOUND · ${msg.roomCode}`, "good");
        this.audio.play("found");
        break;
      case "room_created":
        this.toast(`ROOM ${msg.code} CREATED`, "good");
        break;
      case "match_start":
        if (this.current !== "game") this.go("game", { match_start: msg.config });
        break;
      case "error":
        this.toast(`${msg.code}: ${msg.msg}`, "bad");
        this.audio.play("error");
        break;
      default:
        break;
    }
    if (this.screen?.onMessage) this.screen.onMessage(msg);
  }

  go(id: ScreenId, params: ScreenParams = {}): void {
    if (this.screen) {
      this.screen.unmount();
      this.screenLayer.removeAttribute("style");
    }
    this.particles.clear();
    this.hud.announcer = null;
    this.hud.killFeed = [];
    this.current = id;
    const screen = this.registry[id];
    const handle = screen.mount(this, params);
    this.screen = handle;
    clear(this.screenLayer);
    this.screenLayer.append(handle.root);
    this.emoteBar.classList.toggle("sc-hide", id !== "game");
    this.fitStage();
    this.audio.play("tab");
  }

  toast(msg: string, kind: "info" | "good" | "bad" = "info"): void {
    this.toastCtl.show(msg, kind);
  }

  announce(text: string, color = "#ffd83d", sub?: string, ms = 1800): void {
    this.hud.setAnnounce(text, color, sub, ms);
  }
  shake(amount: number): void {
    if (this.settings.get().reducedShake) return;
    this.shakeAmt = Math.min(8, this.shakeAmt + amount);
  }
  flash(color: string, alpha = 0.6): void {
    this.flashColor = color;
    this.flashAlpha = alpha;
  }
  profile(): Profile | null { return this.net.profile; }
  isHost(): boolean { return this.isHostCache; }
  lobbyCode(): string | null { return this.lobbyCodeCache; }
  pushKill(text: string, color = "#ffffff"): void { this.hud.pushKill(text, color); }

  private onKey(ev: KeyboardEvent, down: boolean): boolean {
    if (this.screen?.onKey) {
      const handled = this.screen.onKey(ev, down);
      if (handled) {
        ev.preventDefault();
        return true;
      }
    }
    return false;
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.ambientT += dt;
    this.audio.resume();

    if (this.screen?.onTick) this.screen.onTick(dt, now);
    this.particles.update(dt);
    this.hud.update(dt);

    this.inputAcc += dt;
    if (this.inputAcc >= 1 / CONFIG.TICK_RATE) {
      this.inputAcc = 0;
    }

    this.render(now);
    this.railPing.textContent = this.pingValue > 0 ? `${Math.round(this.pingValue)}ms` : "—";
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 22);
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 1.6);
  };

  private render(now: number): void {
    const ctx = this.ctx;
    if (this.screen?.onRender) {
      const shakeX = this.shakeAmt > 0 ? (Math.random() * 2 - 1) * this.shakeAmt : 0;
      const shakeY = this.shakeAmt > 0 ? (Math.random() * 2 - 1) * this.shakeAmt : 0;
      ctx.save();
      ctx.translate(shakeX, shakeY);
      this.screen.onRender({ ctx, W: STAGE_W, H: STAGE_H, t: now, dt: 0, shake: this.shakeAmt });
      ctx.restore();
    } else {
      this.renderAmbient(ctx, now);
    }
    this.particles.draw(ctx);
    if (this.flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      ctx.restore();
    }
  }

  private renderAmbient(ctx: CanvasRenderingContext2D, now: number): void {
    const t = now / 1000;
    const pal = paletteFor("beach");
    const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    for (let i = 0; i < 12; i++) {
      const phase = (t * 12 + i * 30) % 280;
      const x = ((i * 53) % STAGE_W) + Math.sin(t + i) * 6;
      const y = STAGE_H - phase;
      ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.10)";
      ctx.fillRect(Math.round(x), Math.round(y), 2 + (i % 3), 1);
    }
    ctx.fillStyle = "rgba(255,216,61,0.55)";
    const sunY = 36 + Math.sin(t * 0.6) * 2;
    ctx.beginPath();
    ctx.arc(220, sunY, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(216, sunY - 3, 4, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const bx = (i * 53 + (t * 8) % STAGE_W) % STAGE_W;
      const by = ((t * 18 + i * 60) % STAGE_H);
      const colors = ["#ff4fa3", "#ffd83d", "#66e08f", "#7ee4ff", "#8a5cf6"];
      const color = colors[i % colors.length] ?? "#ff4fa3";
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(Math.round(bx), Math.round(by), 3, 4);
      ctx.globalAlpha = 1;
    }
  }

  send(msg: ClientMessage): void { this.net.send(msg); }
}

declare global {
  interface Window { __splashApp?: App }
}

const boot = (): void => {
  if (window.__splashApp) return;
  const app = new App();
  window.__splashApp = app;
  app.go("title");
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
