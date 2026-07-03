import { ANIMALS, HATS } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { critterSprite } from "../render/sprites.js";
import { button, hover, panel } from "../render/ui.js";

export class LockerScreen implements Screen {
  private t = 0;
  private previewAnimal = "";
  private previewHat = "";

  enter(): void {
    this.previewAnimal = app.profile?.selectedAnimal ?? "frog";
    this.previewHat = app.profile?.selectedHat ?? "none";
  }

  update(dt: number): void {
    this.t += dt;
  }

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      app.go("menu");
      return true;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "LOCKER", 128, 6, PAL.gold, 2);
    if (button(g, 4, 4, 40, 12, "< BACK")) app.go("menu");

    const unlocks = new Set(app.profile?.unlocks ?? []);
    const level = app.profile?.level ?? 1;

    // live preview with walk cycle
    panel(g, 8, 24, 74, 88, "PREVIEW");
    const frame = Math.floor(this.t * 5) % 2;
    const dir = ([1, 2, 3, 4] as const)[Math.floor(this.t / 1.5) % 4];
    g.drawImage(critterSprite(this.previewAnimal, this.previewHat, frame, dir), 0, 0, 16, 16, 21, 42, 48, 48);
    drawTextCentered(g, ANIMALS.find((a) => a.id === this.previewAnimal)?.name.toUpperCase() ?? "", 45, 96, PAL.white);
    if (this.previewAnimal === "cat") drawTextCentered(g, "HATES WATER", 45, 104, PAL.red);

    // animals grid
    panel(g, 90, 24, 158, 88, "CRITTERS");
    ANIMALS.forEach((a, i) => {
      const x = 96 + (i % 4) * 38;
      const y = 38 + Math.floor(i / 4) * 36;
      const unlocked = unlocks.has(`animal:${a.id}`);
      const selected = app.profile?.selectedAnimal === a.id;
      g.fillStyle = selected ? PAL.uiEdge : "rgba(0,0,0,0.3)";
      g.fillRect(x, y, 34, 32);
      if (selected) {
        g.strokeStyle = PAL.gold;
        g.strokeRect(x + 0.5, y + 0.5, 33, 31);
      }
      if (unlocked) {
        g.drawImage(critterSprite(a.id, "none", 0, 3), 0, 0, 16, 16, x + 5, y + 2, 24, 24);
        drawTextCentered(g, a.name.slice(0, 8).toUpperCase(), x + 17, y + 26, PAL.white);
        if (hover(x, y, 34, 32)) {
          this.previewAnimal = a.id;
          if (app.mouse.clicked) this.select(a.id, app.profile?.selectedHat ?? "none");
        }
      } else {
        g.globalAlpha = 0.35;
        g.drawImage(critterSprite(a.id, "none", 0, 3), 0, 0, 16, 16, x + 5, y + 2, 24, 24);
        g.globalAlpha = 1;
        drawTextCentered(g, `LVL ${a.unlockLevel}`, x + 17, y + 26, level >= a.unlockLevel ? PAL.gold : PAL.gray);
      }
    });

    // hats grid
    panel(g, 8, 118, 240, 66, "HATS");
    HATS.forEach((h, i) => {
      const x = 16 + i * 39;
      const y = 132;
      const unlocked = unlocks.has(`hat:${h.id}`);
      const selected = app.profile?.selectedHat === h.id;
      g.fillStyle = selected ? PAL.uiEdge : "rgba(0,0,0,0.3)";
      g.fillRect(x, y, 34, 44);
      if (selected) {
        g.strokeStyle = PAL.gold;
        g.strokeRect(x + 0.5, y + 0.5, 33, 43);
      }
      const preview = critterSprite(this.previewAnimal, h.id, 0, 3);
      if (unlocked) {
        g.drawImage(preview, 0, 0, 16, 16, x + 5, y + 4, 24, 24);
        drawTextCentered(g, h.name.split(" ")[0].toUpperCase(), x + 17, y + 32, PAL.white);
        if (hover(x, y, 34, 44)) {
          this.previewHat = h.id;
          if (app.mouse.clicked) this.select(app.profile?.selectedAnimal ?? "frog", h.id);
        }
      } else {
        g.globalAlpha = 0.35;
        g.drawImage(preview, 0, 0, 16, 16, x + 5, y + 4, 24, 24);
        g.globalAlpha = 1;
        drawTextCentered(g, `LVL ${h.unlockLevel}`, x + 17, y + 32, level >= h.unlockLevel ? PAL.gold : PAL.gray);
      }
    });

    drawTextCentered(g, "ALL COSMETIC - LEVEL UP TO UNLOCK MORE", 128, 196, PAL.darkgray);
    drawTextCentered(g, `YOU ARE LEVEL ${level}`, 128, 206, PAL.gray);
  }

  private select(animal: string, hat: string): void {
    app.net.send({ t: "set_cosmetics", animal, hat });
    app.audio.sfx("pickup");
  }
}
