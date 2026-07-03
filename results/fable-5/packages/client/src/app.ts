import type { ProfileData, S2C } from "@splash/shared";
import type { AudioSys } from "./audio.js";
import type { InputSys } from "./input.js";
import type { Net } from "./net.js";
import type { Settings } from "./settings.js";

export interface Screen {
  enter?(params?: unknown): void;
  exit?(): void;
  update(dt: number): void;
  draw(g: CanvasRenderingContext2D): void;
  onMessage?(msg: S2C): void;
  onKeyDown?(code: string, key: string): boolean | void; // true = consumed
}

export interface Mouse {
  x: number;
  y: number;
  down: boolean;
  clicked: boolean; // went down this frame
}

interface Toast {
  text: string;
  until: number;
  color: string;
}

/** Global app context every screen leans on. Wired up by main.ts at boot. */
export class App {
  screens = new Map<string, Screen>();
  screenName = "";
  current: Screen | null = null;
  profile: ProfileData | null = null;
  net!: Net;
  audio!: AudioSys;
  keys!: InputSys;
  settings!: Settings;
  mouse: Mouse = { x: 0, y: 0, down: false, clicked: false };
  pingMs = 0;
  connected = false;
  private toasts: Toast[] = [];
  /** Pending room code from a /#/room/CODE share link. */
  pendingRoomCode: string | null = null;

  go(name: string, params?: unknown): void {
    const next = this.screens.get(name);
    if (!next) throw new Error(`no screen: ${name}`);
    this.current?.exit?.();
    this.screenName = name;
    this.current = next;
    this.keys.clear();
    next.enter?.(params);
  }

  toast(text: string, color = "#fff1e8"): void {
    this.toasts.push({ text, until: performance.now() + 3200, color });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  drawToasts(g: CanvasRenderingContext2D, drawTextCentered: (g: CanvasRenderingContext2D, t: string, cx: number, y: number, c: string) => void): void {
    const now = performance.now();
    this.toasts = this.toasts.filter((t) => t.until > now);
    this.toasts.forEach((t, i) => {
      const y = 200 - i * 10;
      g.fillStyle = "rgba(15,15,27,0.85)";
      g.fillRect(28, y - 2, 200, 9);
      drawTextCentered(g, t.text, 128, y, t.color);
    });
  }
}

export const app = new App();
