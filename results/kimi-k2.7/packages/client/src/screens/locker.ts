import type { App, Screen } from "../main.js";
import { ANIMALS, HATS } from "@splash/shared";

export class LockerScreen implements Screen {
  app: App;
  selectedAnimal = 0;
  selectedHat = 0;

  constructor(app: App) {
    this.app = app;
    this.selectedAnimal = ANIMALS.indexOf(this.app.profile?.selectedAnimal || "frog");
    this.selectedHat = HATS.indexOf(this.app.profile?.selectedHat || "none");
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("LOCKER", 128, 20);

    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`Animal: ${ANIMALS[this.selectedAnimal]}`, 40, 70);
    ctx.fillText(`Hat: ${HATS[this.selectedHat]}`, 40, 100);

    ctx.fillStyle = "#facc15";
    ctx.fillText("LEFT/RIGHT animal  UP/DOWN hat  ENTER save", 8, 190);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    if (e.code === "ArrowLeft") this.selectedAnimal = (this.selectedAnimal - 1 + ANIMALS.length) % ANIMALS.length;
    if (e.code === "ArrowRight") this.selectedAnimal = (this.selectedAnimal + 1) % ANIMALS.length;
    if (e.code === "ArrowUp") this.selectedHat = (this.selectedHat + 1) % HATS.length;
    if (e.code === "ArrowDown") this.selectedHat = (this.selectedHat - 1 + HATS.length) % HATS.length;
    if (e.code === "Enter") {
      // In real app, send to server; here update locally
      this.app.profile!.selectedAnimal = ANIMALS[this.selectedAnimal];
      this.app.profile!.selectedHat = HATS[this.selectedHat];
    }
    if (e.code === "Escape") this.app.setScreen("menu");
  }
}
