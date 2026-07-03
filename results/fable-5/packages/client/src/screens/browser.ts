import type { CreateRoomOpts, GameMode, MapTheme, RoomSummary, S2C } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { button, modal, panel, textField, toggle } from "../render/ui.js";
import { TextInput } from "../textinput.js";

const THEMES: (MapTheme | "random")[] = ["random", "backyard", "beach", "pool"];

export class BrowserScreen implements Screen {
  private rooms: RoomSummary[] = [];
  private filter: GameMode | "all" = "all";
  private creating = false;
  private nameInput = new TextInput(24);
  private createMode: GameMode = "ffa";
  private createPublic = true;
  private createTheme = 0;
  private createRounds = 3;
  private createBots = true;
  private refreshTimer = 0;

  enter(params?: unknown): void {
    this.creating = !!(params as { create?: boolean } | undefined)?.create;
    this.nameInput.value = "";
    this.refresh();
  }

  private refresh(): void {
    app.net.send({ t: "room_list_request" });
  }

  onMessage(msg: S2C): void {
    if (msg.t === "room_list") this.rooms = msg.rooms;
  }

  update(dt: number): void {
    this.refreshTimer += dt;
    if (this.refreshTimer > 4) {
      this.refreshTimer = 0;
      this.refresh();
    }
  }

  onKeyDown(code: string, key: string): boolean | void {
    if (this.creating) {
      if (code === "Escape") {
        this.creating = false;
        return true;
      }
      if (code === "Enter") {
        this.submitCreate();
        return true;
      }
      return this.nameInput.handleKey(code, key);
    }
    if (code === "Escape") {
      app.go("menu");
      return true;
    }
  }

  private submitCreate(): void {
    const opts: CreateRoomOpts = {
      name: this.nameInput.value.trim() || "Splash Zone",
      mode: this.createMode,
      isPublic: this.createPublic,
      theme: THEMES[this.createTheme],
      roundsToWin: this.createRounds,
      botFill: this.createBots,
    };
    app.net.send({ t: "create_room", opts });
    this.creating = false;
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "ROOM BROWSER", 128, 6, PAL.waterLight, 2);

    if (button(g, 4, 4, 40, 12, "< BACK")) app.go("menu");
    if (button(g, 212, 4, 40, 12, "NEW +", { color: PAL.gold })) {
      this.creating = true;
      this.nameInput.value = "";
    }

    // filters
    if (button(g, 8, 22, 34, 11, "ALL", { selected: this.filter === "all" })) this.filter = "all";
    if (button(g, 46, 22, 34, 11, "2P", { selected: this.filter === "duel" })) this.filter = "duel";
    if (button(g, 84, 22, 34, 11, "4P", { selected: this.filter === "ffa" })) this.filter = "ffa";
    if (button(g, 200, 22, 48, 11, "REFRESH")) this.refresh();

    panel(g, 8, 38, 240, 172);
    const rows = this.rooms.filter((r) => this.filter === "all" || r.mode === this.filter);
    drawText(g, "NAME", 14, 43, PAL.gray);
    drawText(g, "MODE", 110, 43, PAL.gray);
    drawText(g, "MAP", 140, 43, PAL.gray);
    drawText(g, "PLAYERS", 176, 43, PAL.gray);

    if (rows.length === 0) {
      drawTextCentered(g, "NO OPEN ROOMS - CREATE ONE!", 128, 110, PAL.gray);
    }
    rows.slice(0, 10).forEach((r, i) => {
      const y = 52 + i * 15;
      g.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent";
      g.fillRect(10, y - 2, 236, 14);
      drawText(g, r.name.slice(0, 22).toUpperCase(), 14, y, PAL.white);
      drawText(g, r.mode === "duel" ? "2P" : "4P", 110, y, PAL.waterLight);
      drawText(g, r.theme === "random" ? "?" : r.theme.slice(0, 5).toUpperCase(), 140, y, PAL.gray);
      drawText(g, `${r.players}/${r.maxPlayers}`, 182, y, r.players < r.maxPlayers ? PAL.green : PAL.red);
      if (button(g, 210, y - 2, 34, 11, "JOIN", { disabled: r.players >= r.maxPlayers })) {
        app.net.send({ t: "join_room", code: r.code });
      }
    });

    if (this.creating) this.drawCreateDialog(g);
  }

  private drawCreateDialog(g: CanvasRenderingContext2D): void {
    const m = modal(g, 200, 132, "CREATE ROOM");
    let y = m.y + 4;
    drawText(g, "NAME", m.x + 6, y, PAL.gray);
    textField(g, m.x + 40, y - 3, 152, this.nameInput.value, true, "SPLASH ZONE");
    y += 16;
    drawText(g, "SIZE", m.x + 6, y, PAL.gray);
    if (button(g, m.x + 40, y - 3, 46, 11, "2P DUEL", { selected: this.createMode === "duel" })) this.createMode = "duel";
    if (button(g, m.x + 90, y - 3, 46, 11, "4P FFA", { selected: this.createMode === "ffa" })) this.createMode = "ffa";
    y += 16;
    drawText(g, "MAP", m.x + 6, y, PAL.gray);
    if (button(g, m.x + 40, y - 3, 96, 11, THEMES[this.createTheme].toUpperCase())) {
      this.createTheme = (this.createTheme + 1) % THEMES.length;
    }
    y += 16;
    drawText(g, "ROUNDS", m.x + 6, y, PAL.gray);
    for (const [i, r] of [2, 3, 5].entries()) {
      if (button(g, m.x + 40 + i * 26, y - 3, 22, 11, `${r}`, { selected: this.createRounds === r })) {
        this.createRounds = r;
      }
    }
    y += 16;
    if (toggle(g, m.x + 6, y, "PUBLIC ROOM", this.createPublic)) this.createPublic = !this.createPublic;
    if (toggle(g, m.x + 104, y, "FILL WITH BOTS", this.createBots)) this.createBots = !this.createBots;
    y += 16;
    if (button(g, m.x + 6, y, 90, 13, "CREATE", { color: PAL.gold })) this.submitCreate();
    if (button(g, m.x + 104, y, 90, 13, "CANCEL")) this.creating = false;
  }
}
