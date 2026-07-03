import type { App, Screen } from "../main.js";

export class TutorialScreen implements Screen {
  app: App;
  step = 0;
  t = 0;
  messages = [
    "Welcome! Use WASD or arrows to move.",
    "Press SPACE to drop a water balloon.",
    "Balloons burst in a cross splash.",
    "Hide behind sandcastles and grab power-ups.",
    "Chain splashes by popping another balloon!",
    "Tutorial complete! +50 XP",
  ];

  constructor(app: App) {
    this.app = app;
  }

  update(dt: number) {
    this.t += dt;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("TUTORIAL", 128, 40);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "8px monospace";
    const words = this.messages[this.step].split(" ");
    let line = "";
    let y = 80;
    for (const w of words) {
      if ((line + w).length > 32) {
        ctx.fillText(line, 128, y);
        line = w + " ";
        y += 12;
      } else {
        line += w + " ";
      }
    }
    ctx.fillText(line, 128, y);

    ctx.fillStyle = "#facc15";
    ctx.fillText("SPACE / CLICK to continue", 128, 180);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (down && (e.code === "Space" || e.code === "Enter")) this.advance();
  }

  onMouse(_x: number, _y: number, down: boolean) {
    if (down) this.advance();
  }

  advance() {
    this.step++;
    if (this.step >= this.messages.length) {
      localStorage.setItem("splash_tutorial_done", "1");
      this.app.net.tutorialComplete();
      this.app.setScreen("menu");
    }
  }
}
