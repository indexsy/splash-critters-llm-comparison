import type { App, Screen } from "../main.js";
import type { RoomInfo } from "@splash/shared";

export class BrowserScreen implements Screen {
  app: App;
  rooms: RoomInfo[] = [];
  refreshTimer = 0;
  mode: "duel" | "ffa" | undefined;

  constructor(app: App) {
    this.app = app;
    this.refresh();
  }

  refresh() {
    this.app.net.listRooms(this.mode);
  }

  update(dt: number) {
    this.refreshTimer += dt;
    if (this.refreshTimer > 2) {
      this.refreshTimer = 0;
      this.refresh();
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ROOM BROWSER", 128, 16);

    ctx.font = "7px monospace";
    ctx.textAlign = "left";
    for (let i = 0; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(`${r.name} [${r.code}] ${r.players}/${r.maxPlayers} ${r.theme}`, 8, 36 + i * 14);
    }
    if (this.rooms.length === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("No public rooms. Create one!", 8, 100);
    }

    ctx.fillStyle = "#facc15";
    ctx.fillText("[C]reate  [J]oin code  ESC back", 8, 210);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    if (e.code === "Escape") this.app.setScreen("menu");
    if (e.code === "KeyC") {
      const name = prompt("Room name?") || "Casual";
      const mode = (prompt("Mode (duel/ffa)?") as any) || "ffa";
      this.app.net.createRoom({
        name,
        mode,
        public: true,
        theme: "random",
        roundsToWin: 3,
        botFill: true,
      });
    }
    if (e.code === "KeyJ") {
      const code = prompt("Room code?")?.toUpperCase();
      if (code) this.app.net.joinRoom(code);
    }
  }

  onMouse(_x: number, y: number, down: boolean) {
    if (!down) return;
    for (let i = 0; i < this.rooms.length; i++) {
      if (y >= 28 + i * 14 && y < 40 + i * 14) {
        this.app.net.joinRoom(this.rooms[i].code);
      }
    }
  }

  onMessage(msg: any) {
    if (msg.type === "room_list") this.rooms = msg.rooms;
    if (msg.type === "lobby_state") this.app.setScreen("lobby", { code: msg.code });
    if (msg.type === "room_created") this.app.setScreen("lobby", { code: msg.code });
  }
}
