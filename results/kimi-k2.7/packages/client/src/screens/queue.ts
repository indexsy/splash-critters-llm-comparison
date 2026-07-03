import type { App, Screen } from "../main.js";

export class QueueScreen implements Screen {
  app: App;
  mode: "duel" | "ffa";
  elapsed = 0;
  searchRange = 0;
  startedAt = Date.now();

  constructor(app: App, data: { mode: "duel" | "ffa" }) {
    this.app = app;
    this.mode = data.mode;
    this.app.net.joinQueue(this.mode);
  }

  update(dt: number) {
    this.elapsed += dt;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`QUEUED: ${this.mode.toUpperCase()}`, 128, 80);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "8px monospace";
    ctx.fillText(`Elapsed: ${Math.floor(this.elapsed)}s`, 128, 110);
    ctx.fillText(`Search range: ±${this.searchRange}`, 128, 125);
    ctx.fillText("ESC to cancel", 128, 180);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (down && e.code === "Escape") {
      this.app.net.leaveQueue();
      this.app.setScreen("menu");
    }
  }

  onMessage(msg: any) {
    if (msg.type === "queue_status") {
      this.elapsed = msg.elapsedMs / 1000;
      this.searchRange = msg.searchRange;
    }
    if (msg.type === "match_found") {
      this.app.setScreen("lobby", { code: "RANKED", ranked: true });
    }
    if (msg.type === "lobby_state") {
      this.app.setScreen("lobby", { code: msg.code, ranked: true });
    }
    if (msg.type === "match_start") {
      this.app.setScreen("game", { matchId: msg.matchId, mode: msg.mode, players: msg.players, localId: this.app.profile?.id });
    }
  }
}
