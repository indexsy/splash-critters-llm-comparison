import type { ArenaTheme, RoomSummary } from "@splash/shared";
import type { App } from "../main.js";
import {
  COLORS,
  Screen,
  contains,
  drawButton,
  drawInset,
  drawOcean,
  drawPanel,
  type Button,
} from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";

type Filter = "all" | 2 | 4;

const THEMES: Array<ArenaTheme | "random"> = ["random", "backyard", "beach", "pool"];
const ROUNDS: Array<2 | 3 | 5> = [2, 3, 5];

export class BrowserScreen extends Screen {
  private time = 0;
  private filter: Filter = "all";
  private mode: "none" | "create" | "code" = "none";
  private roomName = "SPLASH SHACK";
  private size: 2 | 4 = 4;
  private isPrivate = false;
  private theme: ArenaTheme | "random" = "random";
  private roundsToWin: 2 | 3 | 5 = 3;
  private botFill = true;
  private code = "";
  private nameFocused = false;
  private buttons: Button[] = [
    { x: 8, y: 5, w: 28, h: 13, label: "BACK", action: "back", small: true },
    { x: 58, y: 24, w: 44, h: 13, label: "ALL", action: "all", small: true },
    { x: 106, y: 24, w: 36, h: 13, label: "2P", action: "2", small: true },
    { x: 146, y: 24, w: 36, h: 13, label: "4P", action: "4", small: true },
    { x: 198, y: 23, w: 48, h: 15, label: "REFRESH", action: "refresh", small: true },
    { x: 14, y: 174, w: 104, h: 20, label: "CREATE ROOM", action: "create-open" },
    { x: 132, y: 174, w: 104, h: 20, label: "JOIN BY CODE", action: "code-open" },
  ];
  private createButtons: Button[] = [
    { x: 36, y: 182, w: 82, h: 16, label: "CANCEL", action: "cancel" },
    { x: 132, y: 182, w: 82, h: 16, label: "CREATE!", action: "create" },
  ];
  private codeButtons: Button[] = [
    { x: 46, y: 136, w: 72, h: 16, label: "CANCEL", action: "cancel" },
    { x: 132, y: 136, w: 72, h: 16, label: "JOIN", action: "join" },
  ];

  enter(): void {
    this.app.audio.setMusic("menu");
    this.app.net.requestRoomList();
  }

  update(dt: number): void {
    this.time += dt;
  }

  private act(action: string): void {
    this.app.audio.unlock();
    this.app.audio.click();
    if (action === "back") {
      this.app.showMenu();
      return;
    }
    if (action === "refresh") {
      this.app.net.requestRoomList();
      return;
    }
    if (action === "all") this.filter = "all";
    if (action === "2") this.filter = 2;
    if (action === "4") this.filter = 4;
    if (action === "create-open") {
      this.mode = "create";
      this.nameFocused = true;
      return;
    }
    if (action === "code-open") {
      this.mode = "code";
      this.code = "";
      return;
    }
    if (action === "cancel") {
      this.mode = "none";
      return;
    }
    if (action === "create") {
      this.create();
      return;
    }
    if (action === "join") {
      this.joinCode();
      return;
    }
    if (action.startsWith("join:")) {
      this.app.net.joinRoom(action.slice(5));
    }
  }

  private create(): void {
    const name = this.roomName.trim() || "SPLASH SHACK";
    if (this.app.connection !== "open") {
      this.app.toast("NOT CONNECTED.");
      return;
    }
    this.app.net.createRoom({
      name,
      size: this.size,
      isPrivate: this.isPrivate,
      theme: this.theme,
      roundsToWin: this.roundsToWin,
      botFill: this.botFill,
    });
    this.mode = "none";
    this.app.toast("OPENING YOUR ROOM...");
  }

  private joinCode(): void {
    if (this.code.length < 3) {
      this.app.toast("ENTER A ROOM CODE.");
      return;
    }
    this.app.net.joinRoom(this.code.toUpperCase());
    this.mode = "none";
  }

  private handleTextKey(event: KeyboardEvent): boolean {
    if (event.code === "Escape") {
      this.mode = "none";
      return true;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      if (this.mode === "create") this.create();
      else this.joinCode();
      return true;
    }
    if (event.code === "Backspace") {
      if (this.mode === "create") this.roomName = this.roomName.slice(0, -1);
      else this.code = this.code.slice(0, -1);
      return true;
    }
    if (event.key.length === 1) {
      if (this.mode === "create" && this.roomName.length < 18 && /^[A-Za-z0-9 _-]$/u.test(event.key)) {
        this.roomName += event.key;
      } else if (this.mode === "code" && this.code.length < 6 && /^[A-Za-z0-9]$/u.test(event.key)) {
        this.code += event.key.toUpperCase();
      }
      return true;
    }
    return true;
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.mode !== "none") return this.handleTextKey(event);
    if (event.code === "Escape") {
      this.app.showMenu();
      return true;
    }
    if (event.code === "KeyR") {
      this.app.net.requestRoomList();
      return true;
    }
    return false;
  }

  private filteredRooms(): RoomSummary[] {
    const rooms = [...this.app.rooms];
    if (this.filter === "all") return rooms;
    return rooms.filter((room) => room.size === this.filter);
  }

  onClick(x: number, y: number): void {
    if (this.mode === "create") {
      if (contains(this.createButtons[0]!, x, y)) this.act("cancel");
      else if (contains(this.createButtons[1]!, x, y)) this.act("create");
      else if (x >= 98 && y >= 52 && x < 220 && y < 66) this.nameFocused = true;
      else if (x >= 98 && y >= 72 && x < 220 && y < 86) this.size = this.size === 2 ? 4 : 2;
      else if (x >= 98 && y >= 92 && x < 220 && y < 106) this.isPrivate = !this.isPrivate;
      else if (x >= 98 && y >= 112 && x < 220 && y < 126) {
        const index = THEMES.indexOf(this.theme);
        this.theme = THEMES[(index + 1) % THEMES.length]!;
      } else if (x >= 98 && y >= 132 && x < 220 && y < 146) {
        this.roundsToWin = ROUNDS[(ROUNDS.indexOf(this.roundsToWin) + 1) % ROUNDS.length]!;
      } else if (x >= 98 && y >= 152 && x < 220 && y < 166) this.botFill = !this.botFill;
      return;
    }
    if (this.mode === "code") {
      if (contains(this.codeButtons[0]!, x, y)) this.act("cancel");
      else if (contains(this.codeButtons[1]!, x, y)) this.act("join");
      return;
    }
    for (const button of this.buttons) {
      if (contains(button, x, y)) {
        this.act(button.action);
        return;
      }
    }
    const rooms = this.filteredRooms().slice(0, 5);
    rooms.forEach((room, index) => {
      const y0 = 42 + index * 24;
      if (y >= y0 && y < y0 + 21) {
        if (x >= 202 && x < 248) this.app.net.joinRoom(room.code);
      }
    });
  }

  onMouseMove(_x: number, _y: number): void {}

  cursorAt(x: number, y: number): string {
    if (this.mode !== "none") return "default";
    if (this.buttons.some((button) => contains(button, x, y))) return "pointer";
    const rooms = this.filteredRooms().slice(0, 5);
    return rooms.some((_room, index) => {
      const y0 = 42 + index * 24;
      return y >= y0 && y < y0 + 21 && x >= 202 && x < 248;
    })
      ? "pointer"
      : "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const rooms = this.filteredRooms();
    drawText(ctx, "CASUAL ROOMS", 42, 8, COLORS.mint);
    drawText(ctx, `${rooms.length} OPEN`, 198, 8, "#72aab6");
    this.buttons.slice(0, 5).forEach((button) => drawButton(ctx, button, false));
    drawPanel(ctx, 8, 40, 240, 126);
    if (rooms.length === 0) {
      drawTextCentered(ctx, "NO OPEN ROOMS YET.", 128, 84, "#82b3bd");
      drawTextCentered(ctx, "CREATE ONE AND INVITE A FRIEND!", 128, 98, "#5c8d98");
      drawTextCentered(ctx, "OR TRY PRACTICE FROM THE MENU.", 128, 112, "#5c8d98");
    }
    rooms.slice(0, 5).forEach((room, index) => {
      const y = 42 + index * 24;
      if (index % 2 === 0) {
        ctx.fillStyle = "rgba(18, 63, 87, 0.32)";
        ctx.fillRect(9, y, 238, 22);
      }
      ctx.fillStyle = room.theme === "beach" ? "#d9bd7d" : room.theme === "pool" ? "#70dce3" : "#54b86a";
      ctx.fillRect(14, y + 3, 5, 16);
      drawText(ctx, room.name.slice(0, 16).toUpperCase(), 23, y + 3, COLORS.foam);
      drawText(ctx, room.host.split("#")[0]!.toUpperCase(), 23, y + 12, "#72a2ad");
      drawText(ctx, `${room.players}/${room.size}`, 152, y + 4, COLORS.yellow);
      drawText(ctx, room.size === 2 ? "DUEL" : "FFA", 152, y + 12, "#7bb5bf");
      drawText(ctx, room.theme === "backyard" ? "YARD" : room.theme === "beach" ? "BEACH" : "POOL", 176, y + 8, "#6da0aa");
      drawButton(ctx, { x: 205, y: y + 3, w: 39, h: 15, label: "JOIN", action: "join", small: true }, false);
    });
    this.buttons.slice(5).forEach((button) => drawButton(ctx, button, false));
    drawTextCentered(ctx, "PUBLIC ROOMS. SHARE A CODE TO INVITE.", 128, 202, "#578b97");
    drawTextCentered(ctx, `STATUS: ${this.app.connection.toUpperCase()}`, 128, 213, this.app.connection === "open" ? "#528c96" : COLORS.coral);
    if (this.mode === "create") this.renderCreate(ctx);
    if (this.mode === "code") this.renderCode(ctx);
  }

  private renderCreate(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(2, 8, 12, 0.8)";
    ctx.fillRect(0, 0, 256, 224);
    drawPanel(ctx, 22, 28, 212, 178);
    drawTextCentered(ctx, "CREATE A ROOM", 128, 38, COLORS.mint, 2);
    drawText(ctx, "ROOM NAME", 34, 56, "#73a8b3");
    drawInset(ctx, 98, 52, 120, 14);
    drawText(ctx, this.roomName, 103, 56, COLORS.foam);
    if (this.nameFocused && Math.floor(this.time * 2) % 2 === 0) {
      ctx.fillStyle = COLORS.teal;
      ctx.fillRect(104 + Math.min(108, this.roomName.length * 6), 56, 1, 7);
    }
    const rows: Array<[string, string]> = [
      ["SIZE", this.size === 2 ? "2 PLAYER DUEL" : "4 PLAYER FFA"],
      ["VISIBILITY", this.isPrivate ? "PRIVATE - CODE" : "PUBLIC - BROWSER"],
      ["THEME", this.theme === "random" ? "RANDOM" : this.theme.toUpperCase()],
      ["ROUNDS", `FIRST TO ${this.roundsToWin}`],
      ["BOTS", this.botFill ? "BOT FILL ON" : "BOT FILL OFF"],
    ];
    rows.forEach(([label, value], index) => {
      const y = 74 + index * 20;
      drawText(ctx, label, 34, y + 4, "#73a8b3");
      ctx.fillStyle = "rgba(18, 63, 87, 0.55)";
      ctx.fillRect(98, y, 120, 16);
      drawText(ctx, value, 104, y + 5, COLORS.foam);
      drawText(ctx, ">", 208, y + 5, COLORS.teal);
    });
    this.createButtons.forEach((button) => drawButton(ctx, button, false));
  }

  private renderCode(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(2, 8, 12, 0.82)";
    ctx.fillRect(0, 0, 256, 224);
    drawPanel(ctx, 38, 72, 180, 92);
    drawTextCentered(ctx, "JOIN BY CODE", 128, 82, COLORS.mint, 2);
    drawTextCentered(ctx, "ENTER THE 6-CHARACTER ROOM CODE", 128, 105, "#7fb3bd");
    drawInset(ctx, 78, 114, 100, 16);
    drawTextCentered(ctx, this.code.padEnd(6, " "), 128, 118, COLORS.foam);
    this.codeButtons.forEach((button) => drawButton(ctx, button, false));
  }
}
