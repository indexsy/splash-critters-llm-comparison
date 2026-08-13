import { CONFIG, type Mode } from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { PAL } from "../render/sprites.js";
import { centerText, drawBtn, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function queuePickScreen(go: (name: string, data?: unknown) => void): Screen {
  const buttons: Btn[] = [
    { x: 48, y: 70, w: 160, h: 24, label: "Duel 1v1", id: "duel" },
    { x: 48, y: 104, w: 160, h: 24, label: "Free-for-All 4p", id: "ffa" },
    { x: 48, y: 160, w: 160, h: 16, label: "Back", id: "back" },
  ];
  return {
    name: "queuepick",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      centerText(ctx, "RANKED", 40, PAL.gold, 12);
      buttons.forEach((b) => drawBtn(ctx, b));
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (b?.id === "back") go("menu");
      if (b?.id === "duel" || b?.id === "ffa") {
        audio.click();
        net.send({ type: "queue_join", mode: b.id as Mode });
        go("queue", b.id);
      }
    },
  };
}

export function queueScreen(go: (name: string, data?: unknown) => void, mode: Mode): Screen {
  let eta = 8;
  let range = 100;
  let elapsed = 0;
  const unsub = net.on((msg) => {
    if (msg.type === "queue_status") {
      eta = msg.eta;
      range = msg.searchRange;
      elapsed = msg.elapsed;
    }
    if (msg.type === "match_found") go("game");
    if (msg.type === "match_start") go("game", msg);
    if (msg.type === "error") err = msg.msg;
  });
  let err = "";
  return {
    name: "queue",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      centerText(ctx, `SEARCHING ${mode.toUpperCase()}`, 60, PAL.gold, 10);
      centerText(ctx, `${elapsed}s   range ±${range}`, 90, PAL.paper, 8);
      centerText(ctx, `eta ~${eta}s`, 108, PAL.accent, 8);
      centerText(ctx, "ESC cancel", 180, PAL.paper, 7);
      if (err) centerText(ctx, err, 150, PAL.danger, 7);
    },
    key(e) {
      if (e.code === "Escape") {
        net.send({ type: "queue_leave" });
        go("menu");
      }
    },
    leave() {
      unsub();
    },
  };
}
