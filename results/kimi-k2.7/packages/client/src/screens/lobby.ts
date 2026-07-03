import type { App, Screen } from "../main.js";
import type { LobbySlot } from "@splash/shared";

export class LobbyScreen implements Screen {
  app: App;
  code: string;
  name = "";
  host = "";
  mode: "duel" | "ffa" = "duel";
  slots: LobbySlot[] = [];
  ranked = false;
  started = false;

  constructor(app: App, data: { code: string; ranked?: boolean }) {
    this.app = app;
    this.code = data.code;
    this.ranked = data.ranked || false;
  }

  update() {}

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("LOBBY", 128, 16);
    ctx.font = "8px monospace";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`${this.name} [${this.code}] ${this.mode}`, 128, 30);

    ctx.textAlign = "left";
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      ctx.fillStyle = s.kind === "human" ? "#4ade80" : s.kind === "bot" ? "#facc15" : "#94a3b8";
      let text = `${i + 1}. ${s.kind}`;
      if (s.nickname) text += ` ${s.nickname}`;
      if (s.difficulty) text += ` (${s.difficulty})`;
      if (s.ready) text += " [READY]";
      ctx.fillText(text, 20, 50 + i * 18);
    }

    ctx.fillStyle = "#facc15";
    ctx.fillText("R: ready  S: start  ESC: leave", 8, 210);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    if (e.code === "Escape") {
      this.app.net.leaveRoom();
      this.app.setScreen("menu");
    }
    if (e.code === "KeyR") this.app.net.setReady(true);
    if (e.code === "KeyS") this.app.net.startMatch();
  }

  onMessage(msg: any) {
    if (msg.type === "lobby_state") {
      this.code = msg.code;
      this.name = msg.name;
      this.host = msg.host;
      this.mode = msg.mode;
      this.slots = msg.slots;
      this.started = msg.started;
    }
    if (msg.type === "match_start") {
      this.app.setScreen("game", { matchId: msg.matchId, mode: msg.mode, players: msg.players, localId: this.app.profile?.id });
    }
  }
}
