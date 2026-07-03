import type { App, Screen } from "../main.js";

export class TitleScreen implements Screen {
  app: App;
  t = 0;

  constructor(app: App) {
    this.app = app;
  }

  update(dt: number) {
    this.t += dt;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = `hsl(${200 + Math.sin(this.t) * 20}, 60%, 20%)`;
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SPLASH CRITTERS", 128, 100);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "8px monospace";
    ctx.fillText("Press SPACE or CLICK to splash in", 128, 130);
  }

  onKey(_e: KeyboardEvent, down: boolean) {
    if (down) this.advance();
  }

  onMouse(_x: number, _y: number, down: boolean) {
    if (down) this.advance();
  }

  advance() {
    if (this.app.profile) {
      this.app.setScreen("menu");
    }
    // else wait for welcome
  }
}
