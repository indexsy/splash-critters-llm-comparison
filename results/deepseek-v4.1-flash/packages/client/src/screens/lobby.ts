import type { Difficulty, LobbySlotView, LobbyView } from "@splash/shared";
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
import { drawAnimal } from "../render/sprites.js";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export class LobbyScreen extends Screen {
  private time = 0;
  private buttons: Button[] = [
    { x: 8, y: 5, w: 38, h: 13, label: "LEAVE", action: "leave", small: true },
    { x: 184, y: 5, w: 64, h: 13, label: "COPY LINK", action: "copy", small: true },
  ];

  enter(): void {
    this.app.audio.setMusic("menu");
    this.app.audio.setShowdown(false);
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.app.lobby) {
      this.app.showBrowser();
    }
  }

  private act(action: string): void {
    this.app.audio.unlock();
    this.app.audio.click();
    const lobby = this.app.lobby;
    if (!lobby) return;
    if (action === "leave") {
      this.app.net.leaveRoom();
      this.app.showBrowser();
    } else if (action === "copy") {
      this.copyInvite(lobby);
    } else if (action === "ready") {
      const self = lobby.slots.find((slot) => slot.playerId === this.app.playerId);
      this.app.net.setReady(!(self?.ready ?? false));
    } else if (action === "start") {
      this.app.net.startMatch();
    }
  }

  private copyInvite(lobby: LobbyView): void {
    const link = `${location.origin}/#/room/${lobby.code}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(link).then(
        () => this.app.toast("INVITE LINK COPIED!"),
        () => this.app.toast(`CODE: ${lobby.code}`),
      );
    } else {
      this.app.toast(`CODE: ${lobby.code}`);
    }
  }

  private cycleSlot(slot: LobbySlotView): void {
    const lobby = this.app.lobby;
    if (!lobby?.youAreHost) return;
    if (slot.kind === "human") return;
    if (slot.kind === "empty") {
      this.app.net.setSlot(slot.slot, "bot", "easy");
      return;
    }
    const index = DIFFICULTIES.indexOf(slot.difficulty ?? "medium");
    if (index >= DIFFICULTIES.length - 1) {
      this.app.net.setSlot(slot.slot, "empty");
    } else {
      this.app.net.setSlot(slot.slot, "bot", DIFFICULTIES[index + 1]!);
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Escape") {
      this.act("leave");
      return true;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      const lobby = this.app.lobby;
      if (!lobby) return true;
      if (lobby.youAreHost) this.act("start");
      else this.act("ready");
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    for (const button of this.buttons) {
      if (contains(button, x, y)) {
        this.act(button.action);
        return;
      }
    }
    const lobby = this.app.lobby;
    if (!lobby) return;
    const bottomY = 184;
    if (x >= 14 && y >= bottomY && x < 126 && y < bottomY + 20) {
      this.act(lobby.youAreHost ? "start" : "ready");
      return;
    }
    if (x >= 132 && y >= bottomY && x < 244 && y < bottomY + 20) {
      this.act("leave");
      return;
    }
    lobby.slots.forEach((slot) => {
      const rect = this.slotRect(slot.slot, lobby.size);
      if (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h) {
        this.cycleSlot(slot);
      }
    });
  }

  cursorAt(x: number, y: number): string {
    if (this.buttons.some((button) => contains(button, x, y))) return "pointer";
    const lobby = this.app.lobby;
    if (!lobby) return "default";
    if (y >= 184 && y < 204 && ((x >= 14 && x < 126) || (x >= 132 && x < 244))) return "pointer";
    return "default";
  }

  private slotRect(index: number, size: number): { x: number; y: number; w: number; h: number } {
    if (size === 2) return { x: index === 0 ? 8 : 132, y: 92, w: 116, h: 70 };
    const col = index % 2;
    const row = Math.floor(index / 2);
    return { x: col === 0 ? 8 : 132, y: 76 + row * 50, w: 116, h: 44 };
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    const lobby = this.app.lobby;
    drawText(ctx, "ROOM LOBBY", 52, 8, COLORS.mint);
    if (!lobby) {
      drawTextCentered(ctx, "LOADING LOBBY...", 128, 100, COLORS.foam);
      return;
    }
    this.buttons.forEach((button) => drawButton(ctx, button, false));
    drawPanel(ctx, 8, 24, 240, 44);
    drawText(ctx, `CODE ${lobby.code}`, 16, 31, COLORS.yellow);
    drawText(ctx, lobby.name.toUpperCase().slice(0, 15), 16, 43, COLORS.foam);
    drawText(
      ctx,
      `${lobby.size}P ${lobby.theme.toUpperCase()} TO ${lobby.roundsToWin}`,
      118,
      31,
      "#80b4be",
    );
    drawText(
      ctx,
      lobby.isPrivate ? "PRIVATE ROOM" : "PUBLIC ROOM",
      118,
      43,
      lobby.isPrivate ? COLORS.pink : "#80b4be",
    );
    drawText(ctx, "SHARE THE CODE OR COPY THE LINK.", 16, 56, "#5e949f");
    lobby.slots.forEach((slot, index) => {
      const r = this.slotRect(index, lobby.size);
      drawSlot(ctx, r.x, r.y, r.w, r.h, slot, this.time, index);
    });
    const memberCount = lobby.slots.filter((slot) => slot.kind !== "empty").length;
    const readyCount = lobby.slots.filter(
      (slot) => slot.kind !== "empty" && slot.kind === "bot" ? true : slot.ready,
    ).length;
    const bottomY = 184;
    const self = lobby.slots.find((slot) => slot.playerId === this.app.playerId);
    drawButton(
      ctx,
      {
        x: 14,
        y: bottomY,
        w: 112,
        h: 20,
        label: lobby.youAreHost ? "START MATCH" : self?.ready ? "UNREADY" : "READY UP",
        action: "start",
      },
      false,
      lobby.youAreHost,
    );
    drawButton(
      ctx,
      { x: 132, y: bottomY, w: 112, h: 20, label: "LEAVE ROOM", action: "leave" },
      false,
    );
    drawTextCentered(
      ctx,
      lobby.youAreHost
        ? `${memberCount} CRITTERS / ${readyCount} READY`
        : `${readyCount}/${memberCount} READY. THE HOST STARTS.`,
      128,
      207,
      "#5b929e",
    );
    drawTextCentered(
      ctx,
      lobby.youAreHost
        ? "CLICK SLOTS TO CYCLE DIFFICULTY."
        : memberCount < 2
          ? "FILL AT LEAST TWO SLOTS."
          : "SHARE THE CODE OR COPY LINK!",
      128,
      216,
      memberCount < 2 ? COLORS.yellow : "#4c818d",
    );
  }
}

function drawSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  slot: LobbySlotView,
  time: number,
  index: number,
): void {
  drawPanel(ctx, x, y, w, h, slot.kind === "empty" ? "rgba(9, 30, 41, 0.88)" : "rgba(10, 43, 59, 0.95)", "#285a67");
  if (slot.kind === "empty") {
    drawTextCentered(ctx, `SLOT ${index + 1}`, x + w / 2, y + 12, "#4f7f8a");
    drawTextCentered(ctx, "WAITING...", x + w / 2, y + 27, "#3e6b76");
    return;
  }
  drawAnimal(ctx, {
    animal: slot.animal,
    hat: slot.hat,
    x: x + 7,
    y: y + (h > 50 ? 18 : 6),
    scale: h > 50 ? 2 : 1.7,
    time,
    moving: false,
    frame: Math.floor(time * 3) % 2,
  });
  drawText(ctx, slot.name.split("#")[0]!.toUpperCase().slice(0, 12), x + 39, y + 8, COLORS.foam);
  drawText(
    ctx,
    slot.host ? "HOST" : slot.kind === "bot" ? "BOT" : slot.playerId === null ? "" : slot.connected ? "HUMAN" : "AWAY",
    x + 39,
    y + 19,
    slot.host ? COLORS.yellow : slot.connected ? "#83b3bd" : COLORS.coral,
  );
  if (slot.kind === "bot") {
    drawText(ctx, (slot.difficulty ?? "medium").toUpperCase(), x + 39, y + 30, COLORS.pink);
  } else {
    drawText(ctx, slot.ready ? "READY" : "NOT READY", x + 39, y + 30, slot.ready ? COLORS.green : "#678f99");
  }
}
