import { CONFIG } from "@splash/shared";
import { audio } from "../audio.js";
import { PAL } from "../render/sprites.js";
import { saveSettings, settings } from "../state.js";
import { centerText, drawBtn, drawText, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function settingsScreen(go: (name: string) => void): Screen {
  const buttons: Btn[] = [
    { x: 8, y: 8, w: 40, h: 12, label: "Back", id: "back" },
    { x: 20, y: 50, w: 70, h: 14, label: "SFX -", id: "sfx-" },
    { x: 166, y: 50, w: 70, h: 14, label: "SFX +", id: "sfx+" },
    { x: 20, y: 72, w: 70, h: 14, label: "MUS -", id: "mus-" },
    { x: 166, y: 72, w: 70, h: 14, label: "MUS +", id: "mus+" },
    { x: 20, y: 98, w: 100, h: 14, label: "Colorblind", id: "cb" },
    { x: 136, y: 98, w: 100, h: 14, label: "Less Shake", id: "shake" },
  ];
  return {
    name: "settings",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      buttons.forEach((b) => drawBtn(ctx, b));
      centerText(ctx, "SETTINGS", 28, PAL.gold, 10);
      centerText(ctx, `SFX ${(settings.sfx * 100) | 0}%   MUS ${(settings.music * 100) | 0}%`, 64, PAL.paper, 7);
      drawText(ctx, `colorblind: ${settings.colorblind ? "ON" : "off"}`, 24, 128, PAL.paper, 7);
      drawText(ctx, `reduced shake: ${settings.reduceShake ? "ON" : "off"}`, 24, 140, PAL.paper, 7);
      drawText(ctx, "M mutes. WASD move, Space/E balloon, 1-4 emotes.", 12, 160, PAL.paper, 6);
      drawText(ctx, "This account is a device token in localStorage.", 12, 176, PAL.danger, 6);
      drawText(ctx, "Losing the token loses the account. No password.", 12, 186, PAL.danger, 6);
      drawText(ctx, "To delete: clear site data for this origin.", 12, 196, PAL.paper, 6);
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (!b) return;
      if (b.id === "back") go("menu");
      if (b.id === "sfx-") settings.sfx = Math.max(0, settings.sfx - 0.1);
      if (b.id === "sfx+") settings.sfx = Math.min(1, settings.sfx + 0.1);
      if (b.id === "mus-") settings.music = Math.max(0, settings.music - 0.1);
      if (b.id === "mus+") settings.music = Math.min(1, settings.music + 0.1);
      if (b.id === "cb") settings.colorblind = !settings.colorblind;
      if (b.id === "shake") settings.reduceShake = !settings.reduceShake;
      audio.sfx = settings.sfx;
      audio.music = settings.music;
      saveSettings();
      audio.click();
    },
    key(e) {
      if (e.code === "Escape") go("menu");
      if (e.code === "KeyM") audio.toggleMute();
    },
  };
}

export function howtoScreen(go: (name: string) => void): Screen {
  return {
    name: "howto",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      centerText(ctx, "HOW TO PLAY", 20, PAL.gold, 10);
      const lines = [
        "Drop water balloons (Space/E). They burst in a cross.",
        "Splashes wash one sandcastle per direction.",
        "Chain balloons for DOUBLE / TRIPLE SPLASH!",
        "Grab Extra Balloon, Big Splash, Flippers, Boots.",
        "Boots let you KICK a balloon in a straight line.",
        "Last critter dry wins the round. First to 3.",
        "At 2:00 the Rising Tide floods inward.",
        "Casual: soaked players ride Revenge Ducks.",
      ];
      lines.forEach((l, i) => drawText(ctx, l, 10, 40 + i * 14, PAL.paper, 6));
      centerText(ctx, "click / ESC back", 210, PAL.accent, 7);
    },
    click() {
      go("menu");
    },
    key(e) {
      if (e.code === "Escape") go("menu");
    },
  };
}
