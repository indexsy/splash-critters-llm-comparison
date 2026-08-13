import { CONFIG } from "@splash/shared";
import { audio } from "../audio.js";
import { drawAnimal, PAL } from "../render/sprites.js";
import { app } from "../state.js";
import { centerText, drawBtn, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function menuScreen(go: (name: string, data?: unknown) => void): Screen {
  audio.startMusic("menu");
  const buttons: Btn[] = [
    { x: 48, y: 52, w: 160, h: 16, label: "Play Ranked", id: "ranked" },
    { x: 48, y: 72, w: 160, h: 16, label: "Casual Rooms", id: "casual" },
    { x: 48, y: 92, w: 160, h: 16, label: "Practice vs Bots", id: "practice" },
    { x: 48, y: 112, w: 160, h: 16, label: "Leaderboard", id: "lb" },
    { x: 48, y: 132, w: 160, h: 16, label: "Locker", id: "locker" },
    { x: 48, y: 152, w: 76, h: 14, label: "How to Play", id: "how" },
    { x: 132, y: 152, w: 76, h: 14, label: "Settings", id: "settings" },
  ];
  let hover = -1;
  let t = 0;
  return {
    name: "menu",
    update() {
      t++;
    },
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      centerText(ctx, "SPLASH CRITTERS", 18, PAL.gold, 12);
      const p = app.profile;
      if (p) {
        centerText(ctx, `${p.nickname}#${p.tag}  Lv${p.level}`, 32, PAL.paper, 7);
        drawAnimal(ctx, 8, 8, p.selectedAnimal, p.selectedHat, Math.floor(t / 12));
      }
      buttons.forEach((b, i) => drawBtn(ctx, b, i === hover));
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (!b) return;
      audio.click();
      if (b.id === "ranked") go("queuepick");
      else if (b.id === "casual") go("browser");
      else if (b.id === "practice") go("practice");
      else if (b.id === "lb") go("leaderboard");
      else if (b.id === "locker") go("locker");
      else if (b.id === "how") go("howto");
      else if (b.id === "settings") go("settings");
    },
    key(e) {
      if (e.code === "Digit1") go("queuepick");
    },
  };
}
