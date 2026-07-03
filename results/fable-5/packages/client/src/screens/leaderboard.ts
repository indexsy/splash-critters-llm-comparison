import type { GameMode, LeaderboardRow } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { drawTierBadge } from "../render/sprites.js";
import { button, panel } from "../render/ui.js";

export class LeaderboardScreen implements Screen {
  private mode: GameMode = "duel";
  private rows: LeaderboardRow[] = [];
  private loading = false;
  private error = false;
  private scroll = 0;

  enter(): void {
    this.fetch();
  }

  private fetch(): void {
    this.loading = true;
    this.error = false;
    this.scroll = 0;
    fetch(`/api/leaderboard?mode=${this.mode}`)
      .then((r) => r.json())
      .then((data: { rows: LeaderboardRow[] }) => {
        this.rows = data.rows;
        this.loading = false;
      })
      .catch(() => {
        this.loading = false;
        this.error = true;
      });
  }

  update(): void {}

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      app.go("menu");
      return true;
    }
    if (code === "ArrowDown") this.scroll = Math.min(Math.max(0, this.rows.length - 12), this.scroll + 1);
    if (code === "ArrowUp") this.scroll = Math.max(0, this.scroll - 1);
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "LEADERBOARD", 128, 6, PAL.gold, 2);
    if (button(g, 4, 4, 40, 12, "< BACK")) app.go("menu");

    if (button(g, 60, 22, 60, 12, "DUEL", { selected: this.mode === "duel" })) {
      this.mode = "duel";
      this.fetch();
    }
    if (button(g, 136, 22, 60, 12, "4P FFA", { selected: this.mode === "ffa" })) {
      this.mode = "ffa";
      this.fetch();
    }

    panel(g, 8, 38, 240, 178);
    drawText(g, "RANK", 12, 43, PAL.gray);
    drawText(g, "PLAYER", 44, 43, PAL.gray);
    drawText(g, "RATING", 150, 43, PAL.gray);
    drawText(g, "GAMES", 188, 43, PAL.gray);
    drawText(g, "WIN%", 220, 43, PAL.gray);

    if (this.loading) drawTextCentered(g, "LOADING...", 128, 120, PAL.gray);
    else if (this.error) drawTextCentered(g, "COULD NOT LOAD - TRY AGAIN", 128, 120, PAL.red);
    else if (this.rows.length === 0) drawTextCentered(g, "NO RANKED GAMES PLAYED YET", 128, 120, PAL.gray);

    this.rows.slice(this.scroll, this.scroll + 12).forEach((r, i) => {
      const y = 52 + i * 13;
      const me = r.playerId === app.profile?.playerId;
      if (me) {
        g.fillStyle = "rgba(255,210,62,0.12)";
        g.fillRect(10, y - 2, 236, 12);
      }
      drawText(g, `${r.rank}`, 14, y, r.rank <= 3 ? PAL.gold : PAL.gray);
      drawTierBadge(g, 28, y - 2, r.tier);
      drawText(g, r.nickname.split("#")[0].slice(0, 12), 44, y, me ? PAL.gold : PAL.white);
      drawText(g, `${r.rating}`, 152, y, PAL.waterLight);
      drawText(g, `${r.games}`, 192, y, PAL.gray);
      drawText(g, `${Math.round(r.winrate * 100)}%`, 220, y, PAL.white);
    });
    if (this.rows.length > 12) drawTextCentered(g, "UP/DOWN TO SCROLL", 128, 218, PAL.darkgray);
  }
}
