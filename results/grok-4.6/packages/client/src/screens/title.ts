import { CONFIG } from "@splash/shared";
import { audio } from "../audio.js";
import { drawAnimal, PAL } from "../render/sprites.js";
import { app } from "../state.js";
import { centerText } from "../ui.js";
import type { Screen } from "./types.js";

export function titleScreen(go: (name: string) => void): Screen {
  let t = 0;
  audio.startMusic("title");
  return {
    name: "title",
    update() {
      t++;
    },
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = i % 2 ? PAL.water : PAL.water2;
        ctx.fillRect((i * 20 + t) % 280 - 12, 180 + Math.sin((t + i * 8) / 10) * 4, 16, 6);
      }
      centerText(ctx, "SPLASH CRITTERS", 50, PAL.gold, 14);
      centerText(ctx, "last critter dry wins", 66, PAL.paper, 7);
      const animals = ["frog", "duck", "otter", "penguin"] as const;
      animals.forEach((a, i) => {
        drawAnimal(ctx, 40 + i * 48, 90, a, "none", Math.floor(t / 12) + i);
      });
      if (Math.floor(t / 30) % 2 === 0) centerText(ctx, "press any key", 170, PAL.accent, 8);
    },
    key() {
      audio.click();
      go(app.seenTutorial ? "menu" : "tutorial");
    },
    click() {
      audio.click();
      go(app.seenTutorial ? "menu" : "tutorial");
    },
  };
}
