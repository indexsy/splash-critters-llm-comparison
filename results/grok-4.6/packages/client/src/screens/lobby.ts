import { CONFIG, type BotDifficulty, type ServerMsg, type SlotState } from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { drawAnimal, PAL } from "../render/sprites.js";
import { app } from "../state.js";
import { centerText, drawBtn, drawText, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function lobbyScreen(go: (name: string, data?: unknown) => void): Screen {
  let lobby: Extract<ServerMsg, { type: "lobby_state" }> | null = null;
  const unsub = net.on((msg) => {
    if (msg.type === "lobby_state") lobby = msg;
    if (msg.type === "match_start") go("game", msg);
    if (msg.type === "error") err = msg.msg;
  });
  let err = "";
  const buttons: Btn[] = [
    { x: 8, y: 8, w: 40, h: 12, label: "Leave", id: "leave" },
    { x: 160, y: 200, w: 88, h: 16, label: "START", id: "start" },
    { x: 8, y: 200, w: 70, h: 16, label: "Ready", id: "ready" },
  ];
  return {
    name: "lobby",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      buttons.forEach((b) => drawBtn(ctx, b));
      if (!lobby) {
        centerText(ctx, "Joining…", 110, PAL.paper, 8);
        return;
      }
      centerText(ctx, lobby.name, 28, PAL.gold, 10);
      centerText(ctx, `${lobby.code}  ${lobby.mode}  FT${lobby.roundsToWin}  ${lobby.theme}`, 40, PAL.paper, 7);
      drawText(ctx, "Share /#/room/" + lobby.code, 8, 50, PAL.accent, 6);
      lobby.slots.forEach((s, i) => drawSlot(ctx, s, 20 + (i % 2) * 118, 62 + Math.floor(i / 2) * 64, i));
      if (err) centerText(ctx, err, 190, PAL.danger, 7);
    },
    click(x, y) {
      const b = buttons.find((bt) => hit(bt, x, y));
      if (b?.id === "leave") {
        net.send({ type: "leave_room" });
        go("browser");
      }
      if (b?.id === "ready") net.send({ type: "set_ready", ready: true });
      if (b?.id === "start") net.send({ type: "start_match" });
      if (!lobby || lobby.hostId !== app.playerId) return;
      lobby.slots.forEach((s, i) => {
        const sx = 20 + (i % 2) * 118;
        const sy = 62 + Math.floor(i / 2) * 64;
        if (x >= sx && x <= sx + 108 && y >= sy && y <= sy + 56 && s.kind !== "human") {
          const cycle: Array<{ kind: "empty" | "bot"; d?: BotDifficulty }> = [
            { kind: "empty" },
            { kind: "bot", d: "easy" },
            { kind: "bot", d: "medium" },
            { kind: "bot", d: "hard" },
          ];
          const cur =
            s.kind === "bot"
              ? s.difficulty === "easy"
                ? 1
                : s.difficulty === "hard"
                  ? 3
                  : 2
              : 0;
          const next = cycle[(cur + 1) % cycle.length]!;
          net.send({ type: "set_slot", slot: s.index, kind: next.kind, difficulty: next.d });
          audio.click();
        }
      });
    },
    key(e) {
      if (e.code === "Escape") {
        net.send({ type: "leave_room" });
        go("menu");
      }
    },
    leave() {
      unsub();
    },
  };
}

function drawSlot(ctx: CanvasRenderingContext2D, s: SlotState, x: number, y: number, _i: number): void {
  ctx.fillStyle = s.ready ? "#1e3a2f" : PAL.ui;
  ctx.fillRect(x, y, 108, 56);
  ctx.strokeStyle = PAL.paper;
  ctx.strokeRect(x + 0.5, y + 0.5, 107, 55);
  if (s.kind === "empty") {
    drawText(ctx, "EMPTY", x + 8, y + 30, PAL.paper, 8);
    drawText(ctx, "click: add bot", x + 8, y + 44, PAL.accent, 6);
    return;
  }
  drawAnimal(ctx, x + 4, y + 16, s.animal ?? "frog", s.hat ?? "none", 0);
  drawText(ctx, (s.nickname ?? "?").slice(0, 12), x + 28, y + 20, PAL.paper, 7);
  drawText(ctx, s.kind === "bot" ? `BOT ${s.difficulty}` : s.ready ? "READY" : "…", x + 28, y + 34, PAL.gold, 6);
}
