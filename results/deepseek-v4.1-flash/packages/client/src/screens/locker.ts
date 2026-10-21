import { ANIMALS, HATS, type AnimalId, type HatId } from "@splash/shared";
import type { App } from "../main.js";
import { COLORS, Screen, drawButton, drawOcean, drawPanel, type Button } from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { drawAnimal } from "../render/sprites.js";

export class LockerScreen extends Screen {
  private time = 0;
  private animal: AnimalId = "frog";
  private hat: HatId = "none";
  private back: Button = { x: 8, y: 5, w: 30, h: 13, label: "BACK", action: "back", small: true };

  enter(): void {
    this.app.audio.setMusic("menu");
    if (this.app.profile) {
      this.animal = this.app.profile.selectedAnimal;
      this.hat = this.app.profile.selectedHat;
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.app.profile) {
      if (this.app.profile.selectedAnimal !== this.animal && this.app.profile.unlocks.includes(this.animal)) {
        this.animal = this.app.profile.selectedAnimal;
      }
      if (this.app.profile.selectedHat !== this.hat && this.app.profile.unlocks.includes(this.hat)) {
        this.hat = this.app.profile.selectedHat;
      }
    }
  }

  private unlocked(id: string): boolean {
    return this.app.profile?.unlocks.includes(id) ?? false;
  }

  private selectAnimal(id: AnimalId, level: number): void {
    if (!this.unlocked(id)) {
      this.app.toast(`UNLOCKS AT LEVEL ${level}.`);
      return;
    }
    this.animal = id;
    this.app.audio.pickup();
    this.app.net.setCosmetics(id, this.hat);
  }

  private selectHat(id: HatId, level: number): void {
    if (!this.unlocked(id)) {
      this.app.toast(`UNLOCKS AT LEVEL ${level}.`);
      return;
    }
    this.hat = id;
    this.app.audio.pickup();
    this.app.net.setCosmetics(this.animal, id);
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Escape") {
      this.app.showMenu();
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    if (x >= 8 && y >= 5 && x < 38 && y < 18) {
      this.app.showMenu();
      return;
    }
    ANIMALS.forEach((entry, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const bx = 8 + col * 60;
      const by = 90 + row * 28;
      if (x >= bx && y >= by && x < bx + 58 && y < by + 26) {
        this.selectAnimal(entry.id, entry.level);
      }
    });
    HATS.forEach((entry, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const bx = 8 + col * 80;
      const by = 156 + row * 23;
      if (x >= bx && y >= by && x < bx + 76 && y < by + 21) {
        this.selectHat(entry.id, entry.level);
      }
    });
  }

  cursorAt(x: number, y: number): string {
    if (x >= 8 && y >= 5 && x < 38 && y < 18) return "pointer";
    return "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const profile = this.app.profile;
    drawText(ctx, "LOCKER", 44, 8, COLORS.mint);
    drawButton(ctx, this.back, false);
    drawPanel(ctx, 8, 22, 240, 58);
    ctx.fillStyle = "rgba(46, 196, 182, 0.08)";
    ctx.fillRect(16, 28, 54, 48);
    ctx.fillStyle = "rgba(3, 13, 20, 0.32)";
    ctx.fillRect(16, 71, 54, 5);
    drawAnimal(ctx, {
      animal: this.animal,
      hat: this.hat,
      x: 30,
      y: 39,
      scale: 2.4,
      time: this.time,
      moving: true,
      frame: Math.floor(this.time * 4) % 2,
    });
    const animalDef = ANIMALS.find((entry) => entry.id === this.animal);
    const hatDef = HATS.find((entry) => entry.id === this.hat);
    drawText(ctx, animalDef?.name ?? "FROG", 80, 31, COLORS.foam, 2);
    drawText(ctx, `HAT: ${hatDef?.name ?? "NONE"}`, 80, 48, COLORS.yellow);
    drawText(ctx, animalDef?.blurb.toUpperCase() ?? "", 80, 59, "#7dafb9");
    drawText(ctx, `LV ${profile?.level ?? 1} / ${profile?.unlocks.length ?? 0} UNLOCKED`, 80, 69, "#598c98");
    drawText(ctx, "ANIMALS", 8, 82, COLORS.mint);
    ANIMALS.forEach((entry, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const bx = 8 + col * 60;
      const by = 90 + row * 28;
      const unlocked = this.unlocked(entry.id);
      const selected = this.animal === entry.id;
      drawPanel(
        ctx,
        bx,
        by,
        58,
        26,
        selected ? "rgba(21, 91, 98, 0.95)" : "rgba(8, 36, 49, 0.9)",
        selected ? COLORS.mint : unlocked ? "#2d6472" : "#263f48",
      );
      drawAnimal(ctx, {
        animal: entry.id,
        hat: "none",
        x: bx + 2,
        y: by + 8,
        scale: 0.9,
        time: this.time + index,
        noHat: true,
      });
      const animalLabel = entry.id === "capybara" ? "CAPY" : entry.name;
      drawText(ctx, animalLabel.slice(0, 7), bx + 15, by + 7, unlocked ? COLORS.foam : "#5c7882");
      if (!unlocked) {
        drawText(ctx, `LV${entry.level}`, bx + 15, by + 16, COLORS.coral);
      } else if (selected) {
        drawText(ctx, "ON", bx + 15, by + 16, COLORS.mint);
      }
    });
    drawText(ctx, "HATS", 8, 147, COLORS.mint);
    HATS.forEach((entry, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const bx = 8 + col * 80;
      const by = 156 + row * 23;
      const unlocked = this.unlocked(entry.id);
      const selected = this.hat === entry.id;
      drawPanel(
        ctx,
        bx,
        by,
        76,
        21,
        selected ? "rgba(21, 91, 98, 0.95)" : "rgba(8, 36, 49, 0.9)",
        selected ? COLORS.mint : unlocked ? "#2d6472" : "#263f48",
      );
      drawAnimal(ctx, {
        animal: "frog",
        hat: entry.id,
        x: bx + 2,
        y: by + 7,
        scale: 0.9,
        time: this.time + index,
      });
      const hatLabels: Record<HatId, string> = {
        none: "NO HAT",
        bucket: "BUCKET HAT",
        snorkel: "SNORKEL",
        crown: "TINY CROWN",
        bandana: "BANDANA",
        propeller: "PROPELLER",
      };
      drawText(ctx, hatLabels[entry.id], bx + 17, by + 3, unlocked ? COLORS.foam : "#5c7882");
      if (!unlocked) drawText(ctx, `LV${entry.level}`, bx + 17, by + 11, COLORS.coral);
      else if (selected) drawText(ctx, "ON", bx + 17, by + 11, COLORS.mint);
    });
    drawTextCentered(ctx, "COSMETICS ARE STYLE ONLY. NO STATS.", 128, 208, "#5b8c97");
    drawTextCentered(ctx, "KEEP SPLASHING TO UNLOCK MORE.", 128, 217, "#477983");
  }
}
