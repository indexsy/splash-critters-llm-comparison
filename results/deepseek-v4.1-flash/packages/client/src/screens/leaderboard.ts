import type { GameMode, LeaderboardEntry, LeaderboardResponse } from "@splash/shared";
import type { App } from "../main.js";
import {
  COLORS,
  TIER_COLORS,
  Screen,
  contains,
  drawButton,
  drawOcean,
  drawPanel,
  type Button,
} from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";

const PER_PAGE = 8;

export class LeaderboardScreen extends Screen {
  private time = 0;
  private mode: GameMode = "duel";
  private entries: LeaderboardEntry[] = [];
  private page = 0;
  private loading = true;
  private error = "";
  private request = 0;
  private buttons: Button[] = [
    { x: 8, y: 5, w: 30, h: 13, label: "BACK", action: "back", small: true },
    { x: 72, y: 24, w: 52, h: 14, label: "DUEL", action: "duel", small: true },
    { x: 128, y: 24, w: 52, h: 14, label: "FFA", action: "ffa", small: true },
    { x: 198, y: 24, w: 48, h: 14, label: "REFRESH", action: "refresh", small: true },
    { x: 30, y: 194, w: 56, h: 16, label: "< PREV", action: "prev", small: true },
    { x: 170, y: 194, w: 56, h: 16, label: "NEXT >", action: "next", small: true },
  ];

  enter(): void {
    this.app.audio.setMusic("menu");
    this.fetch();
  }

  update(dt: number): void {
    this.time += dt;
  }

  private async fetch(): Promise<void> {
    this.loading = true;
    this.error = "";
    const request = ++this.request;
    try {
      const response = await fetch(`/api/leaderboard?mode=${this.mode}`);
      if (!response.ok) throw new Error("bad status");
      const data = (await response.json()) as LeaderboardResponse;
      if (request !== this.request) return;
      this.entries = data.entries;
      this.page = 0;
    } catch {
      if (request !== this.request) return;
      this.error = "COULD NOT LOAD THE LEADERBOARD.";
      this.entries = [];
    } finally {
      if (request === this.request) this.loading = false;
    }
  }

  private act(action: string): void {
    this.app.audio.unlock();
    this.app.audio.click();
    if (action === "back") {
      this.app.showMenu();
    } else if (action === "duel" || action === "ffa") {
      if (this.mode !== action) {
        this.mode = action;
        void this.fetch();
      }
    } else if (action === "refresh") {
      void this.fetch();
    } else if (action === "prev") {
      this.page = Math.max(0, this.page - 1);
    } else if (action === "next") {
      const max = Math.max(0, Math.ceil(this.entries.length / PER_PAGE) - 1);
      this.page = Math.min(max, this.page + 1);
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Escape") {
      this.app.showMenu();
      return true;
    }
    if (event.code === "ArrowLeft") {
      this.act("prev");
      return true;
    }
    if (event.code === "ArrowRight") {
      this.act("next");
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    for (const button of this.buttons) {
      if (contains(button, x, y)) {
        this.act(button.action);
        return;
      }
    }
  }

  cursorAt(x: number, y: number): string {
    return this.buttons.some((button) => contains(button, x, y)) ? "pointer" : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    drawText(ctx, "LEADERBOARD", 44, 8, COLORS.mint);
    drawText(ctx, `TOP ${this.entries.length}`, 196, 8, "#5f929d");
    this.buttons.slice(0, 4).forEach((button) => {
      drawButton(ctx, button, false, button.action === this.mode);
    });
    drawPanel(ctx, 8, 42, 240, 146);
    ctx.fillStyle = "rgba(18, 63, 87, 0.6)";
    ctx.fillRect(9, 43, 238, 13);
    drawText(ctx, "#", 16, 46, "#6fa3ad");
    drawText(ctx, "CRITTER", 30, 46, "#6fa3ad");
    drawText(ctx, "RATING", 137, 46, "#6fa3ad");
    drawText(ctx, "TIER", 181, 46, "#6fa3ad");
    drawText(ctx, "GMS", 229, 46, "#6fa3ad");
    if (this.loading) {
      drawTextCentered(ctx, "LOADING THE POND...", 128, 105, COLORS.foam);
    } else if (this.error) {
      drawTextCentered(ctx, this.error, 128, 105, COLORS.coral);
      drawTextCentered(ctx, "CHECK YOUR CONNECTION AND RETRY.", 128, 119, "#719ea8");
    } else if (this.entries.length === 0) {
      drawTextCentered(ctx, "NO RANKED MATCHES YET.", 128, 102, COLORS.foam);
      drawTextCentered(ctx, "BE THE FIRST CRITTER ON THE BOARD!", 128, 116, "#6f9da7");
    } else {
      const start = this.page * PER_PAGE;
      this.entries.slice(start, start + PER_PAGE).forEach((entry, index) => {
        const y = 59 + index * 16;
        const local = entry.playerId === this.app.playerId;
        if (index % 2 === 0) {
          ctx.fillStyle = "rgba(8, 34, 47, 0.5)";
          ctx.fillRect(9, y - 2, 238, 15);
        }
        if (local) {
          ctx.fillStyle = "rgba(46, 196, 182, 0.15)";
          ctx.fillRect(9, y - 2, 238, 15);
        }
        const rankColor = entry.rank <= 3 ? [COLORS.yellow, "#d7e3e6", "#e8a76a"][entry.rank - 1]! : "#76a4ae";
        drawText(ctx, `${entry.rank}`, 17, y, rankColor);
        drawText(ctx, entry.displayName.toUpperCase().slice(0, 16), 30, y, local ? COLORS.mint : COLORS.foam);
        drawText(ctx, `${Math.round(entry.rating)}`, 144, y, COLORS.yellow);
        const tier = entry.tier.toUpperCase();
        ctx.fillStyle = TIER_COLORS[tier.charAt(0) + tier.slice(1).toLowerCase()] ?? COLORS.teal;
        ctx.fillRect(181, y, 4, 7);
        drawText(ctx, tier, 189, y, TIER_COLORS[tier.charAt(0) + tier.slice(1).toLowerCase()] ?? COLORS.teal);
        drawText(ctx, `${entry.games}`, 232, y, "#87b2bc");
      });
    }
    const pageCount = Math.max(1, Math.ceil(this.entries.length / PER_PAGE));
    drawButton(
      ctx,
      { ...this.buttons[4]!, disabled: this.page <= 0 } as Button,
      false,
    );
    drawTextCentered(ctx, `PAGE ${this.page + 1} / ${pageCount}`, 128, 200, "#6b9ca7");
    drawButton(
      ctx,
      { ...this.buttons[5]!, disabled: this.page >= pageCount - 1 } as Button,
      false,
    );
    drawTextCentered(ctx, this.mode === "duel" ? "1V1 RANKED LADDER" : "4-PLAYER RANKED LADDER", 128, 216, "#4f7f8a");
  }
}
