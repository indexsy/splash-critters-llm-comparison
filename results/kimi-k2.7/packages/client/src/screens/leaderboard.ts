import type { App, Screen } from "../main.js";
import type { LeaderboardEntry, Mode } from "@splash/shared";

export class LeaderboardScreen implements Screen {
  app: App;
  mode: Mode = "duel";
  entries: LeaderboardEntry[] = [];

  constructor(app: App, data?: { mode?: Mode }) {
    this.app = app;
    if (data?.mode) this.mode = data.mode;
    this.fetch();
  }

  fetch() {
    fetch(`/api/leaderboard?mode=${this.mode}`)
      .then((r) => r.json())
      .then((j) => (this.entries = j.entries));
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LEADERBOARD: ${this.mode.toUpperCase()}`, 128, 16);

    ctx.font = "7px monospace";
    ctx.textAlign = "left";
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      ctx.fillStyle = i < 3 ? "#facc15" : "#e2e8f0";
      ctx.fillText(`${e.rank}. ${e.nickname}#${e.tag} ${e.rating} ${e.tier}`, 8, 32 + i * 12);
    }

    ctx.fillStyle = "#94a3b8";
    ctx.fillText("TAB: switch mode  ESC: back", 8, 210);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    if (e.code === "Tab") {
      this.mode = this.mode === "duel" ? "ffa" : "duel";
      this.fetch();
    }
    if (e.code === "Escape") this.app.setScreen("menu");
  }
}
