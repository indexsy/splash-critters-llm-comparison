import { CONFIG, type ServerMsg, xpForLevel, levelFromXp } from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { PAL } from "../render/sprites.js";
import { app } from "../state.js";
import { centerText, drawBtn, drawText, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function resultsScreen(go: (name: string) => void, data: Extract<ServerMsg, { type: "match_end" }>): Screen {
  audio.win();
  let t = 0;
  const buttons: Btn[] = [
    { x: 40, y: 200, w: 80, h: 14, label: "Continue", id: "go" },
    { x: 136, y: 200, w: 80, h: 14, label: "Rematch", id: "rematch" },
  ];
  const mine = data.placements.find((p) => p.playerId === app.playerId);
  const startXp = (app.profile?.xp ?? 0) - (mine?.xpEarned ?? 0);
  return {
    name: "results",
    update() {
      t++;
    },
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      centerText(ctx, "MATCH RESULTS", 16, PAL.gold, 10);
      data.placements.forEach((p, i) => {
        const y = 32 + i * 22;
        drawText(ctx, `#${p.place}  ${p.nickname}#${p.tag}`, 12, y, p.playerId === app.playerId ? PAL.gold : PAL.paper, 7);
        drawText(ctx, `soaks ${p.soaks}  rounds ${p.roundsWon}  +${p.xpEarned}xp`, 12, y + 9, PAL.paper, 6);
        if (p.ratingAfter !== undefined) {
          const d = (p.ratingAfter ?? 0) - (p.ratingBefore ?? 0);
          drawText(ctx, `${p.ratingBefore}→${p.ratingAfter} (${d >= 0 ? "+" : ""}${d})`, 170, y, PAL.accent, 6);
        }
      });
      const shown = Math.min(1, t / 40);
      const xpNow = startXp + Math.floor((mine?.xpEarned ?? 0) * shown);
      const lvl = levelFromXp(xpNow);
      const into = xpNow - [...Array(lvl).keys()].reduce((s, i) => (i ? s + xpForLevel(i) : s), 0);
      const need = xpForLevel(lvl);
      ctx.fillStyle = PAL.ui;
      ctx.fillRect(20, 148, 216, 8);
      ctx.fillStyle = PAL.gold;
      ctx.fillRect(20, 148, 216 * Math.min(1, into / need), 8);
      drawText(ctx, `Lv${lvl}  ${into}/${need} xp`, 20, 164, PAL.paper, 6);
      const fun = data.fun;
      let fy = 174;
      if (fun.mostSoaks) drawText(ctx, `Most Soaks: ${fun.mostSoaks.name} ${fun.mostSoaks.value}`, 20, fy, PAL.accent, 6);
      if (fun.castleCrusher) drawText(ctx, `Castle Crusher: ${fun.castleCrusher.name}`, 20, fy + 8, PAL.accent, 6);
      buttons.forEach((b) => drawBtn(ctx, b));
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (b?.id === "go") go("menu");
      if (b?.id === "rematch") {
        net.send({ type: "rematch_vote" });
        go("lobby");
      }
    },
  };
}
