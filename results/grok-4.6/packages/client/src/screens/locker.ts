import { ANIMALS, CONFIG, HATS, type AnimalId, type HatId } from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { drawAnimal, PAL } from "../render/sprites.js";
import { app } from "../state.js";
import { centerText, drawBtn, drawText, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function lockerScreen(go: (name: string) => void): Screen {
  let t = 0;
  const p = () => app.profile;
  let ai = Math.max(0, ANIMALS.findIndex((a) => a.id === p()?.selectedAnimal));
  let hi = Math.max(0, HATS.findIndex((h) => h.id === p()?.selectedHat));
  const buttons: Btn[] = [
    { x: 8, y: 8, w: 40, h: 12, label: "Back", id: "back" },
    { x: 88, y: 190, w: 80, h: 16, label: "Equip", id: "equip" },
  ];
  const unsub = net.on((msg) => {
    if (msg.type === "profile" || msg.type === "welcome") {
      if (msg.type === "profile") app.profile = msg.profile;
    }
  });
  return {
    name: "locker",
    update() {
      t++;
    },
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      buttons.forEach((b) => drawBtn(ctx, b));
      centerText(ctx, "LOCKER", 28, PAL.gold, 10);
      const prof = p();
      const unlocked = new Set(prof?.unlocks ?? ["frog", "duck", "none"]);
      const a = ANIMALS[ai]!;
      const h = HATS[hi]!;
      const okA = unlocked.has(a.id) || (prof?.level ?? 1) >= a.unlockLevel;
      const okH = unlocked.has(h.id) || (prof?.level ?? 1) >= h.unlockLevel;
      drawAnimal(ctx, 112, 50, a.id, h.id, Math.floor(t / 10));
      centerText(ctx, `${a.name}  +  ${h.name}`, 90, okA && okH ? PAL.paper : PAL.danger, 8);
      centerText(ctx, `← → animal   [ ] hat`, 108, PAL.accent, 6);
      drawText(ctx, `Level ${prof?.level ?? 1}  XP ${prof?.xp ?? 0}`, 12, 130, PAL.paper, 7);
      ANIMALS.forEach((an, i) => {
        ctx.fillStyle = i === ai ? PAL.gold : unlocked.has(an.id) ? PAL.paper : "#555";
        ctx.fillRect(12 + i * 28, 144, 24, 18);
        drawText(ctx, an.name.slice(0, 3), 14 + i * 28, 156, PAL.ink, 6);
      });
      if (!okA) centerText(ctx, `Unlocks at lv ${a.unlockLevel}`, 180, PAL.danger, 6);
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (b?.id === "back") go("menu");
      if (b?.id === "equip") {
        const a = ANIMALS[ai]!.id as AnimalId;
        const h = HATS[hi]!.id as HatId;
        net.send({ type: "set_cosmetic", animal: a, hat: h });
        if (app.profile) {
          app.profile.selectedAnimal = a;
          app.profile.selectedHat = h;
        }
        audio.click();
      }
    },
    key(e) {
      if (e.code === "ArrowLeft") ai = (ai + ANIMALS.length - 1) % ANIMALS.length;
      if (e.code === "ArrowRight") ai = (ai + 1) % ANIMALS.length;
      if (e.code === "BracketLeft") hi = (hi + HATS.length - 1) % HATS.length;
      if (e.code === "BracketRight") hi = (hi + 1) % HATS.length;
      if (e.code === "Escape") go("menu");
    },
    leave() {
      unsub();
    },
  };
}
