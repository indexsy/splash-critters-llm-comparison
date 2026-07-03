import type { App, Screen } from "../main.js";

export class SettingsScreen implements Screen {
  app: App;
  nickname = "";

  constructor(app: App) {
    this.app = app;
    this.nickname = app.profile?.nickname || "";
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SETTINGS", 128, 20);

    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`Nickname: ${this.nickname}`, 20, 60);
    ctx.fillText("M: toggle mute", 20, 90);
    ctx.fillText("Warning: losing your token = losing account.", 20, 130);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("Press N to set nickname, ESC back", 20, 190);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    if (e.code === "KeyN") {
      const name = prompt("Nickname (3-16 chars)?");
      if (name) {
        this.app.net.setNickname(name);
        this.nickname = name;
      }
    }
    if (e.code === "Escape") this.app.setScreen("menu");
  }
}
