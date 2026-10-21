import type { AnimalId, HatId } from "@splash/shared";
import type { App } from "../main.js";
import { COLORS, Screen, drawButton, drawCloud, drawOcean, drawSun, type Button } from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { drawAnimal, drawBalloon, drawDuckie } from "../render/sprites.js";

const PARADE: Array<{ animal: AnimalId; hat: HatId }> = [
  { animal: "frog", hat: "bucket" },
  { animal: "duck", hat: "snorkel" },
  { animal: "otter", hat: "bandana" },
  { animal: "penguin", hat: "crown" },
  { animal: "cat", hat: "propeller" },
  { animal: "raccoon", hat: "bucket" },
  { animal: "turtle", hat: "none" },
  { animal: "capybara", hat: "snorkel" },
];

export class TitleScreen extends Screen {
  private time = 0;
  private start: Button = { x: 82, y: 174, w: 92, h: 24, label: "PRESS ENTER", action: "start" };

  enter(): void {
    this.app.audio.setMusic("title");
    this.app.audio.setShowdown(false);
  }

  update(dt: number): void {
    this.time += dt;
  }

  private begin(): void {
    this.app.audio.unlock();
    this.app.audio.click();
    if (!this.app.profile) {
      this.app.toast("CONNECTING TO THE POND...");
      return;
    }
    if (!this.app.profile.tutorialDone) {
      this.app.showTutorial();
    } else {
      this.app.finishTitle();
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Enter" || event.code === "Space" || event.code === "NumpadEnter") {
      this.begin();
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    if (x >= this.start.x && y >= this.start.y && x < this.start.x + this.start.w && y < this.start.y + this.start.h) {
      this.begin();
    }
  }

  cursorAt(x: number, y: number): string {
    return x >= this.start.x && y >= this.start.y && x < this.start.x + this.start.w && y < this.start.y + this.start.h
      ? "pointer"
      : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time);
    drawSun(ctx, 218, 42, this.time);
    drawCloud(ctx, 30, 26, 2);
    drawCloud(ctx, 170, 58, 1.5);
    ctx.fillStyle = "#0b3a4d";
    ctx.fillRect(0, 152, 256, 4);
    ctx.fillStyle = "#176377";
    for (let x = 0; x < 256; x += 16) {
      const offset = Math.floor(this.time * 12 + x) % 16;
      ctx.fillRect(x, 158 + (offset > 8 ? 1 : 0), 10, 2);
    }
    for (let i = 0; i < 256; i += 3) {
      const h = 2 + Math.floor((Math.sin(this.time * 2 + i * 0.12) + 1) * 2);
      ctx.fillStyle = i % 6 === 0 ? "#2ec4b6" : "#1d8794";
      ctx.fillRect(i, 150 - h, 3, h);
    }

    const bob = Math.floor(this.time * 2) % 2;
    PARADE.forEach((entry, index) => {
      const x = 8 + index * 31;
      const y = 134 + Math.floor(Math.sin(this.time * 2.2 + index) * 2) + bob;
      drawAnimal(ctx, {
        ...entry,
        x,
        y,
        scale: 1,
        frame: Math.floor(this.time * 4 + index) % 2,
        moving: false,
        time: this.time,
      });
    });
    drawBalloon(ctx, 14, 110 + Math.sin(this.time * 3) * 2, 0.2, this.time);
    drawDuckie(ctx, 224, 117 + Math.floor(this.time * 2) % 2, 1, this.time);

    ctx.fillStyle = "rgba(4, 18, 27, 0.72)";
    ctx.fillRect(0, 44, 256, 58);
    drawTextCentered(ctx, "SPLASH", 128, 50, COLORS.foam, 3, "#0a2635");
    drawTextCentered(ctx, "CRITTERS", 128, 72, COLORS.mint, 3, "#0a2635");
    drawTextCentered(ctx, "AN 8-BIT WATER BALLOON BATTLE", 128, 95, "#80c5ce");

    drawButton(ctx, this.start, false, false);
    if (this.app.profile) {
      const status =
        this.app.connection === "open"
          ? `${this.app.profile.displayName}  LV ${this.app.profile.level}`
          : this.app.connection.toUpperCase();
      drawTextCentered(ctx, status, 128, 204, "#7cb3bd");
    } else {
      drawTextCentered(ctx, "CONNECTING...", 128, 204, "#7cb3bd");
    }
    drawText(ctx, "MOVE WASD", 8, 214, "#4d8794");
    drawText(ctx, "DROP SPACE", 192, 214, "#4d8794");
  }
}
