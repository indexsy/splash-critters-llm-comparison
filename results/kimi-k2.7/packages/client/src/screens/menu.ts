import type { App, Screen } from "../main.js";

export class MenuScreen implements Screen {
  app: App;
  items = [
    { label: "Ranked Duel", action: () => this.app.setScreen("queue", { mode: "duel" }) },
    { label: "Ranked FFA", action: () => this.app.setScreen("queue", { mode: "ffa" }) },
    { label: "Casual Rooms", action: () => this.app.setScreen("browser") },
    { label: "Practice vs Bots", action: () => this.app.net.createRoom({ name: "Practice", mode: "duel", public: false, theme: "random", roundsToWin: 3, botFill: true }) },
    { label: "Leaderboard", action: () => this.app.setScreen("leaderboard") },
    { label: "Locker", action: () => this.app.setScreen("locker") },
    { label: "Tutorial", action: () => this.app.setScreen("tutorial") },
    { label: "Settings", action: () => this.app.setScreen("settings") },
  ];
  selected = 0;

  constructor(app: App) {
    this.app = app;
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("MAIN MENU", 128, 24);

    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    for (let i = 0; i < this.items.length; i++) {
      ctx.fillStyle = i === this.selected ? "#facc15" : "#e2e8f0";
      ctx.fillText(this.items[i].label, 60, 48 + i * 18);
    }

    const p = this.app.profile;
    if (p) {
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "right";
      ctx.fillText(`${p.nickname} #${p.tag} Lv${p.level}`, 248, 16);
    }
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    if (e.code === "ArrowDown") this.selected = (this.selected + 1) % this.items.length;
    if (e.code === "ArrowUp") this.selected = (this.selected - 1 + this.items.length) % this.items.length;
    if (e.code === "Enter" || e.code === "Space") this.items[this.selected].action();
  }

  onMouse(_x: number, y: number, down: boolean) {
    if (!down) return;
    for (let i = 0; i < this.items.length; i++) {
      if (y >= 40 + i * 18 && y < 56 + i * 18) {
        this.items[i].action();
      }
    }
  }
}
