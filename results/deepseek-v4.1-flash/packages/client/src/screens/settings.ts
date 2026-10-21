import type { Action } from "../settings.js";
import { keyLabel } from "../settings.js";
import type { App } from "../main.js";
import { COLORS, Screen, drawButton, drawOcean, drawPanel, drawProgress, type Button } from "../ui.js";
import { drawText, drawTextCentered, textWidth } from "../render/font.js";

const ACTIONS: Array<{ action: Action; label: string }> = [
  { action: "up", label: "UP" },
  { action: "down", label: "DOWN" },
  { action: "left", label: "LEFT" },
  { action: "right", label: "RIGHT" },
  { action: "drop", label: "DROP" },
];

export class SettingsScreen extends Screen {
  private time = 0;
  private capture: Action | null = null;
  private back: Button = { x: 8, y: 5, w: 30, h: 13, label: "BACK", action: "back", small: true };
  private reset: Button = { x: 14, y: 190, w: 70, h: 16, label: "RESET", action: "reset" };

  enter(): void {
    this.app.audio.setMusic("menu");
  }

  update(dt: number): void {
    this.time += dt;
  }

  private actionAt(x: number, y: number): string | null {
    if (x >= 14 && x < 32) return null;
    if (y >= 32 && y < 44) {
      if (x >= 194 && x < 208) return "music-down";
      if (x >= 237 && x < 248) return "music-up";
    }
    if (y >= 46 && y < 58) {
      if (x >= 194 && x < 208) return "sfx-down";
      if (x >= 237 && x < 248) return "sfx-up";
    }
    if (y >= 62 && y < 76) return "mute";
    if (y >= 78 && y < 92) return "colorblind";
    if (y >= 94 && y < 108) return "shake";
    if (y >= 110 && y < 124) {
      if (x >= 150 && x < 178) return "lag0";
      if (x >= 182 && x < 224) return "lag150";
      return null;
    }
    for (let index = 0; index < ACTIONS.length; index += 1) {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const ry = 143 + row * 13;
      if (y >= ry && y < ry + 12) {
        const rx = col === 0 ? 16 : 132;
        if (x >= rx && x < rx + 106) return `bind:${ACTIONS[index]!.action}`;
      }
    }
    return null;
  }

  private act(action: string): void {
    this.app.audio.unlock();
    this.app.audio.click();
    const settings = this.app.settings;
    if (action === "back") {
      this.app.showMenu();
      return;
    }
    if (action === "reset") {
      settings.reset();
      this.app.audio.syncSettings();
      this.app.net.setLatency(0);
      this.app.toast("SETTINGS RESTORED.");
      return;
    }
    if (action === "music-down") settings.set("musicVolume", Math.max(0, settings.data.musicVolume - 0.1));
    else if (action === "music-up") settings.set("musicVolume", Math.min(1, settings.data.musicVolume + 0.1));
    else if (action === "sfx-down") settings.set("sfxVolume", Math.max(0, settings.data.sfxVolume - 0.1));
    else if (action === "sfx-up") settings.set("sfxVolume", Math.min(1, settings.data.sfxVolume + 0.1));
    else if (action === "mute") settings.set("muted", !settings.data.muted);
    else if (action === "colorblind") settings.set("colorblind", !settings.data.colorblind);
    else if (action === "shake") settings.set("reducedShake", !settings.data.reducedShake);
    else if (action === "lag0") {
      settings.set("devLatency", 0);
      this.app.net.setLatency(0);
      this.app.toast("NETWORK SIMULATION OFF.");
    } else if (action === "lag150") {
      settings.set("devLatency", 150);
      this.app.net.setLatency(150);
      this.app.toast("150MS DEV LATENCY ON.");
    } else if (action.startsWith("bind:")) {
      this.capture = action.slice(5) as Action;
    }
    this.app.audio.syncSettings();
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.capture) {
      if (event.code !== "Escape") {
        this.app.settings.rebind(this.capture, event.code);
        this.app.toast(`${this.capture.toUpperCase()} SET TO ${keyLabel(event.code)}`);
      }
      this.capture = null;
      return true;
    }
    if (event.code === "Escape") {
      this.app.showMenu();
      return true;
    }
    if (event.code === "Minus") {
      this.app.settings.set("musicVolume", Math.max(0, this.app.settings.data.musicVolume - 0.1));
      this.app.audio.syncSettings();
      return true;
    }
    if (event.code === "Equal") {
      this.app.settings.set("musicVolume", Math.min(1, this.app.settings.data.musicVolume + 0.1));
      this.app.audio.syncSettings();
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    if (x >= 8 && y >= 5 && x < 38 && y < 18) {
      this.act("back");
      return;
    }
    if (x >= 14 && y >= 190 && x < 84 && y < 206) {
      this.act("reset");
      return;
    }
    const action = this.actionAt(x, y);
    if (action) this.act(action);
  }

  cursorAt(x: number, y: number): string {
    if ((x >= 8 && y >= 5 && x < 38 && y < 18) || (x >= 14 && y >= 190 && x < 84 && y < 206)) {
      return "pointer";
    }
    return this.actionAt(x, y) ? "pointer" : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const data = this.app.settings.data;
    drawText(ctx, "SETTINGS", 44, 8, COLORS.mint);
    drawButton(ctx, this.back, false);
    drawPanel(ctx, 8, 24, 240, 101);
    drawText(ctx, "AUDIO + ACCESSIBILITY", 16, 29, COLORS.yellow);
    drawText(ctx, "MUSIC", 16, 41, COLORS.foam);
    drawProgress(ctx, 58, 42, 130, 5, data.musicVolume, COLORS.teal);
    drawText(ctx, "-", 194, 38, COLORS.foam, 1);
    drawText(ctx, "+", 238, 38, COLORS.foam, 1);
    drawText(ctx, "SFX", 16, 55, COLORS.foam);
    drawProgress(ctx, 58, 56, 130, 5, data.sfxVolume, COLORS.teal);
    drawText(ctx, "-", 194, 52, COLORS.foam, 1);
    drawText(ctx, "+", 238, 52, COLORS.foam, 1);
    this.toggleRow(ctx, 16, 62, "MUTE (M)", data.muted);
    this.toggleRow(ctx, 16, 78, "COLORBLIND SPLASH", data.colorblind);
    this.toggleRow(ctx, 16, 94, "REDUCED SHAKE", data.reducedShake);
    drawText(ctx, "DEV LATENCY", 16, 111, "#87b7c0");
    this.pill(ctx, 150, 110, 26, "0", data.devLatency === 0);
    this.pill(ctx, 182, 110, 42, "150MS", data.devLatency === 150);
    drawPanel(ctx, 8, 128, 240, 74);
    drawText(ctx, "KEYS", 16, 133, COLORS.yellow);
    if (this.capture) {
      drawText(ctx, `PRESS A KEY FOR ${this.capture.toUpperCase()}...`, 54, 133, COLORS.mint);
    } else {
      drawText(ctx, "CLICK A ROW TO REBIND", 54, 133, "#527f8a");
    }
    ACTIONS.forEach((entry, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = col === 0 ? 16 : 132;
      const y = 143 + row * 13;
      if (this.capture === entry.action) {
        ctx.fillStyle = "rgba(46, 196, 182, 0.18)";
        ctx.fillRect(x, y, 106, 12);
      }
      drawText(ctx, entry.label, x, y + 2, "#8bbac3");
      const key = keyLabel(data.bindings[entry.action][0] ?? "?").replace("ARROW ", "ARW ");
      drawText(ctx, key, x + 106 - textWidth(key), y + 2, COLORS.foam);
    });
    drawButton(ctx, this.reset, false);
    drawText(ctx, "TOKEN = ACCOUNT", 88, 190, COLORS.coral);
    drawText(ctx, "NO PASSWORDS. NO RECOVERY.", 88, 199, "#5e8e99");
    drawTextCentered(ctx, "LOSE THIS TOKEN, LOSE THIS ACCOUNT.", 128, 214, "#4d7d88");
  }

  private toggleRow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    on: boolean,
  ): void {
    drawText(ctx, label, x, y + 3, "#8bbac3");
    this.pill(ctx, 187, y, 52, on ? "ON" : "OFF", on);
  }

  private pill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    label: string,
    on: boolean,
  ): void {
    ctx.fillStyle = on ? "#1c756f" : "#133342";
    ctx.fillRect(x, y, w, 12);
    ctx.strokeStyle = on ? COLORS.mint : "#2e5a68";
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 11);
    drawTextCentered(ctx, label, x + w / 2, y + 3, on ? COLORS.foam : "#6d97a2");
  }
}
