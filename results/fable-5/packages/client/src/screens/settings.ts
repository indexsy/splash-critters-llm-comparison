import { app, type Screen } from "../app.js";
import type { Action } from "../input.js";
import { saveSettings } from "../settings.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { button, panel, slider, toggle } from "../render/ui.js";

const REBINDABLE: { action: Action; label: string }[] = [
  { action: "up", label: "MOVE UP" },
  { action: "down", label: "MOVE DOWN" },
  { action: "left", label: "MOVE LEFT" },
  { action: "right", label: "MOVE RIGHT" },
  { action: "drop", label: "DROP BALLOON" },
];

export class SettingsScreen implements Screen {
  private rebinding: Action | null = null;

  enter(): void {
    this.rebinding = null;
  }

  update(): void {}

  onKeyDown(code: string): boolean | void {
    if (this.rebinding) {
      if (code !== "Escape") {
        app.keys.rebind(this.rebinding, code);
        app.settings.bindings = app.keys.bindings;
        saveSettings(app.settings);
      }
      this.rebinding = null;
      return true;
    }
    if (code === "Escape") {
      app.go("menu");
      return true;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "SETTINGS", 128, 6, PAL.gold, 2);
    if (button(g, 4, 4, 40, 12, "< BACK")) {
      saveSettings(app.settings);
      app.go("menu");
    }

    const s = app.settings;

    panel(g, 8, 24, 118, 92, "AUDIO");
    drawText(g, "SFX", 14, 40, PAL.white);
    const sfx = slider(g, 40, 38, 76, s.sfxVolume);
    if (sfx !== s.sfxVolume) {
      s.sfxVolume = sfx;
      app.audio.applyVolumes();
    }
    drawText(g, "MUSIC", 14, 54, PAL.white);
    const mus = slider(g, 40, 52, 76, s.musicVolume);
    if (mus !== s.musicVolume) {
      s.musicVolume = mus;
      app.audio.applyVolumes();
    }
    if (toggle(g, 14, 68, "MUTE ALL (M)", s.muted)) {
      app.audio.toggleMute();
      saveSettings(s);
    }
    if (button(g, 14, 84, 100, 12, "TEST SOUND")) app.audio.sfx("burst");

    panel(g, 132, 24, 116, 92, "ACCESSIBILITY");
    if (toggle(g, 138, 40, "COLORBLIND", s.colorblindSplash)) {
      s.colorblindSplash = !s.colorblindSplash;
      saveSettings(s);
    }
    drawText(g, "GOLD SPLASHES", 138, 51, PAL.gray);
    if (toggle(g, 138, 64, "LESS SHAKE", s.reduceShake)) {
      s.reduceShake = !s.reduceShake;
      saveSettings(s);
    }
    drawText(g, "REDUCED SCREEN", 138, 75, PAL.gray);
    drawText(g, "SHAKE ON BURSTS", 138, 83, PAL.gray);

    panel(g, 8, 120, 240, 62, "CONTROLS");
    REBINDABLE.forEach((r, i) => {
      const x = 14 + (i % 3) * 80;
      const y = 134 + Math.floor(i / 3) * 22;
      drawText(g, r.label, x, y, PAL.gray);
      const bound = this.rebinding === r.action ? "PRESS KEY..." : prettyCode(app.keys.bindings[r.action][0] ?? "?");
      if (button(g, x, y + 7, 70, 11, bound, { selected: this.rebinding === r.action })) {
        this.rebinding = r.action;
      }
    });
    drawText(g, "EMOTES: 1-4   MUTE: M", 14, 172, PAL.darkgray);

    panel(g, 8, 186, 240, 30, "ACCOUNT");
    drawText(g, "GUEST ACCOUNT - LOSING YOUR TOKEN = LOSING PROGRESS", 14, 199, PAL.gray);
    if (button(g, 14, 206, 90, 9, "COPY TOKEN")) {
      const token = localStorage.getItem("splash-token") ?? sessionStorage.getItem("splash-session-token") ?? "";
      void navigator.clipboard?.writeText(token);
      app.toast("TOKEN COPIED - KEEP IT SAFE!", PAL.gold);
    }
    drawText(g, `YOU: ${app.profile?.nickname ?? "?"}${app.profile?.tag ?? ""}`, 112, 207, PAL.white);
  }
}

function prettyCode(code: string): string {
  return code
    .replace("Key", "")
    .replace("Arrow", "")
    .replace("Digit", "")
    .toUpperCase()
    .slice(0, 9);
}
