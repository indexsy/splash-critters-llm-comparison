import type { GameMode } from "@splash/shared";
import type { App } from "../main.js";
import { COLORS, Screen, drawButton, drawOcean, drawPanel, drawProgress, formatTime, type Button } from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { drawAnimal, drawBalloon } from "../render/sprites.js";

export class QueueScreen extends Screen {
  private time = 0;
  private startedAt = performance.now();
  private cancelButton: Button = { x: 78, y: 182, w: 100, h: 20, label: "CANCEL SEARCH", action: "cancel" };

  constructor(app: App, readonly mode: GameMode) {
    super(app);
  }

  enter(): void {
    this.startedAt = performance.now();
    this.app.audio.setMusic("menu");
  }

  update(dt: number): void {
    this.time += dt;
  }

  private cancel(): void {
    this.app.audio.click();
    this.app.net.queueLeave();
    this.app.showMenu();
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Escape" || event.code === "Enter") {
      this.cancel();
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    if (x >= 78 && y >= 182 && x < 178 && y < 202) this.cancel();
  }

  cursorAt(x: number, y: number): string {
    return x >= 78 && y >= 182 && x < 178 && y < 202 ? "pointer" : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const status = this.app.queueStatus;
    const elapsed = status?.elapsedMs ?? performance.now() - this.startedAt;
    const range = status?.searchRange ?? 100;
    const eta = status?.eta ?? 0;
    const modeLabel = this.mode === "duel" ? "RANKED DUEL" : "RANKED FFA";
    drawText(ctx, "RANKED MATCHMAKING", 12, 8, COLORS.mint);
    drawText(ctx, `SEARCHING ${modeLabel}`, 12, 21, "#6ea8b3");
    drawPanel(ctx, 22, 40, 212, 136);
    const bob = Math.sin(this.time * 2.6);
    drawAnimal(ctx, {
      animal: this.app.profile?.selectedAnimal ?? "frog",
      hat: this.app.profile?.selectedHat ?? "none",
      x: 105,
      y: 50 + Math.round(bob * 2),
      scale: 2.5,
      time: this.time,
      moving: true,
      frame: Math.floor(this.time * 5) % 2,
    });
    drawBalloon(ctx, 151, 66 + Math.round(Math.sin(this.time * 3.4) * 3), 0.1, this.time);
    drawBalloon(ctx, 82, 70 + Math.round(Math.sin(this.time * 2.8 + 1) * 3), 0.2, this.time);
    drawTextCentered(ctx, modeLabel, 128, 101, COLORS.yellow, 2);
    const etaLabel = eta > 0 && eta < 180 ? `RIVALS ~${eta}S` : "RIVALS...";
    drawTextCentered(ctx, `SEARCHING FOR ${etaLabel}`, 128, 120, COLORS.foam);
    drawTextCentered(ctx, `ELAPSED ${formatTime(elapsed)}`, 128, 131, "#7eafb9");
    drawTextCentered(ctx, `RATING RANGE +/- ${range}`, 128, 142, "#7eafb9");
    const pulse = (this.time * 0.8) % 1;
    drawProgress(ctx, 52, 154, 152, 5, pulse, COLORS.teal);
    drawTextCentered(ctx, this.app.connection === "open" ? "THE POND IS SEARCHING..." : "RECONNECTING...", 128, 166, "#5b8e99");
    drawButton(ctx, this.cancelButton, false);
    drawTextCentered(ctx, "DUEL AND FFA HAVE SEPARATE RATINGS.", 128, 211, "#4f7f8a");
  }
}
