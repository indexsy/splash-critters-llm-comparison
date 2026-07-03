import type { BotDifficulty, S2C } from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { critterSprite } from "../render/sprites.js";
import { button, panel } from "../render/ui.js";

type LobbyState = Extract<S2C, { t: "lobby_state" }>;

const DIFF_ORDER: BotDifficulty[] = ["easy", "medium", "hard"];

export class LobbyScreen implements Screen {
  private state: LobbyState | null = null;
  private t = 0;
  private ready = false;

  enter(params?: unknown): void {
    const p = params as { state?: LobbyState } | undefined;
    if (p?.state) this.state = p.state;
    this.ready = false;
    app.audio.music("menu");
  }

  onMessage(msg: S2C): void {
    if (msg.t === "lobby_state") {
      this.state = msg;
      const mySlot = msg.slots[msg.yourSlot];
      if (mySlot?.kind === "human") this.ready = mySlot.ready ?? false;
    }
    // match_start is routed globally to the game screen
  }

  update(dt: number): void {
    this.t += dt;
  }

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      this.leave();
      return true;
    }
  }

  private leave(): void {
    app.net.send({ t: "leave_room" });
    app.go("menu");
  }

  private get isHost(): boolean {
    return !!this.state && this.state.yourSlot === this.state.hostSlot;
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    const s = this.state;
    if (!s) {
      drawTextCentered(g, "JOINING ROOM...", 128, 104, PAL.gray);
      return;
    }

    drawTextCentered(g, s.name.toUpperCase().slice(0, 24), 128, 6, PAL.waterLight, 2);
    drawTextCentered(
      g,
      `${s.mode === "duel" ? "DUEL" : "FREE-FOR-ALL"} - FIRST TO ${s.roundsToWin} - ${s.theme === "random" ? "RANDOM MAP" : s.theme.toUpperCase()}`,
      128,
      22,
      PAL.gray
    );

    // room code + share link
    panel(g, 60, 32, 136, 26);
    drawTextCentered(g, `CODE: ${s.code}`, 128, 37, PAL.gold, 1);
    if (button(g, 88, 46, 80, 10, "COPY INVITE LINK")) {
      const url = `${location.origin}/#/room/${s.code}`;
      void navigator.clipboard?.writeText(url);
      app.toast("LINK COPIED!", PAL.green);
    }

    // slots
    const slotW = 116;
    s.slots.forEach((slot, i) => {
      const x = 8 + (i % 2) * (slotW + 8);
      const y = 66 + Math.floor(i / 2) * 46;
      panel(g, x, y, slotW, 42);
      drawText(g, `SLOT ${i + 1}${i === s.hostSlot ? " (HOST)" : ""}`, x + 4, y + 3, PAL.gray);
      if (slot.kind === "human") {
        const sprite = critterSprite(slot.animal ?? "frog", slot.hat ?? "none", Math.floor(this.t * 3) % 2, 3);
        g.drawImage(sprite, 0, 0, 16, 16, x + 4, y + 12, 24, 24);
        drawText(g, (slot.nickname ?? "?").split("#")[0].slice(0, 12), x + 32, y + 15, slot.connected === false ? PAL.gray : PAL.white);
        if (i === s.hostSlot) drawText(g, "READY", x + 32, y + 25, PAL.green);
        else drawText(g, slot.ready ? "READY" : "NOT READY", x + 32, y + 25, slot.ready ? PAL.green : PAL.gold);
        if (slot.connected === false) drawText(g, "OFFLINE", x + 32, y + 33, PAL.red);
      } else if (slot.kind === "bot") {
        g.drawImage(critterSprite("duck", "none", 0, 3), 0, 0, 16, 16, x + 4, y + 12, 24, 24);
        drawText(g, "BOT", x + 32, y + 15, PAL.waterLight);
        if (this.isHost) {
          if (button(g, x + 32, y + 24, 44, 11, (slot.difficulty ?? "medium").toUpperCase())) {
            const next = DIFF_ORDER[(DIFF_ORDER.indexOf(slot.difficulty ?? "medium") + 1) % 3];
            app.net.send({ t: "set_slot", slot: i, kind: "bot", difficulty: next });
          }
          if (button(g, x + 82, y + 24, 26, 11, "X")) {
            app.net.send({ t: "set_slot", slot: i, kind: "open" });
          }
        } else {
          drawText(g, (slot.difficulty ?? "medium").toUpperCase(), x + 32, y + 26, PAL.gray);
        }
      } else if (slot.kind === "open") {
        drawText(g, "WAITING...", x + 4, y + 18, PAL.gray);
        if (this.isHost) {
          if (button(g, x + 4, y + 28, 52, 11, "ADD BOT")) {
            app.net.send({ t: "set_slot", slot: i, kind: "bot", difficulty: "medium" });
          }
          if (button(g, x + 60, y + 28, 48, 11, "CLOSE")) {
            app.net.send({ t: "set_slot", slot: i, kind: "closed" });
          }
        }
      } else {
        drawText(g, "CLOSED", x + 4, y + 18, PAL.darkgray);
        if (this.isHost && button(g, x + 4, y + 28, 48, 11, "OPEN")) {
          app.net.send({ t: "set_slot", slot: i, kind: "open" });
        }
      }
    });

    // bottom controls
    const controlsY = 66 + Math.ceil(s.slots.length / 2) * 46 + 6;
    if (this.isHost) {
      if (button(g, 78, controlsY, 100, 16, "START MATCH", { color: PAL.gold })) {
        app.net.send({ t: "start_match" });
      }
    } else {
      if (button(g, 78, controlsY, 100, 16, this.ready ? "READY!" : "CLICK WHEN READY", { selected: this.ready })) {
        this.ready = !this.ready;
        app.net.send({ t: "set_ready", ready: this.ready });
      }
    }
    if (button(g, 8, 206, 60, 12, "< LEAVE")) this.leave();
    drawTextCentered(g, s.isPublic ? "PUBLIC ROOM" : "PRIVATE ROOM", 210, 210, PAL.darkgray);
  }
}
