import { CONFIG, type LeaderboardEntry, type Mode } from "@splash/shared";
import { PAL } from "../render/sprites.js";
import { centerText, drawBtn, drawText, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function leaderboardScreen(go: (name: string) => void): Screen {
  let mode: Mode = "duel";
  let rows: LeaderboardEntry[] = [];
  const load = () => {
    fetch(`/api/leaderboard?mode=${mode}`)
      .then((r) => r.json())
      .then((d) => {
        rows = d;
      })
      .catch(() => {
        rows = [];
      });
  };
  load();
  const buttons: Btn[] = [
    { x: 8, y: 8, w: 40, h: 12, label: "Back", id: "back" },
    { x: 80, y: 8, w: 50, h: 12, label: "Duel", id: "duel" },
    { x: 134, y: 8, w: 50, h: 12, label: "FFA", id: "ffa" },
  ];
  return {
    name: "leaderboard",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      buttons.forEach((b) => drawBtn(ctx, b));
      centerText(ctx, `TOP ${mode.toUpperCase()}`, 36, PAL.gold, 9);
      rows.slice(0, 14).forEach((r, i) => {
        drawText(
          ctx,
          `${r.rank}. ${r.nickname}#${r.tag}  ${r.rating} ${r.tier}  ${r.games}g ${r.winrate}%`,
          8,
          50 + i * 11,
          i === 0 ? PAL.gold : PAL.paper,
          6,
        );
      });
      if (!rows.length) centerText(ctx, "No ranked games yet", 120, PAL.paper, 7);
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (b?.id === "back") go("menu");
      if (b?.id === "duel") {
        mode = "duel";
        load();
      }
      if (b?.id === "ffa") {
        mode = "ffa";
        load();
      }
    },
  };
}
