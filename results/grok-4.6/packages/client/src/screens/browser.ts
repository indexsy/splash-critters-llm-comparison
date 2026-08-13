import { CONFIG, type CreateRoomOpts, type RoomInfo } from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { PAL } from "../render/sprites.js";
import { centerText, drawBtn, drawText, hit, type Btn } from "../ui.js";
import type { Screen } from "./types.js";

export function browserScreen(go: (name: string, data?: unknown) => void): Screen {
  let rooms: RoomInfo[] = [];
  let filter: "all" | "duel" | "ffa" = "all";
  let creating = false;
  const opts: CreateRoomOpts = {
    name: "Puddle Pit",
    size: 4,
    public: true,
    theme: "random",
    roundsToWin: 3,
    botFill: true,
  };
  const unsub = net.on((msg) => {
    if (msg.type === "room_list") rooms = msg.rooms;
    if (msg.type === "room_created" || msg.type === "lobby_state") go("lobby");
    if (msg.type === "error") lastErr = msg.msg;
  });
  net.send({ type: "room_list_request" });
  let lastErr = "";
  const buttons: Btn[] = [
    { x: 8, y: 8, w: 40, h: 12, label: "Back", id: "back" },
    { x: 52, y: 8, w: 50, h: 12, label: "Refresh", id: "refresh" },
    { x: 106, y: 8, w: 70, h: 12, label: "Create", id: "create" },
    { x: 180, y: 8, w: 68, h: 12, label: "Join Code", id: "code" },
  ];

  return {
    name: "browser",
    update() {},
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      buttons.forEach((b) => drawBtn(ctx, b));
      centerText(ctx, filter === "all" ? "ALL ROOMS" : filter.toUpperCase(), 32, PAL.gold, 8);
      drawText(ctx, "1 all  2 duel  3 ffa", 8, 42, PAL.paper, 6);
      const list = rooms.filter((r) => filter === "all" || r.mode === filter);
      list.slice(0, 10).forEach((r, i) => {
        const y = 50 + i * 14;
        ctx.fillStyle = i % 2 ? "#2a2048" : PAL.ui;
        ctx.fillRect(8, y, 240, 13);
        drawText(
          ctx,
          `${r.name.slice(0, 12)}  ${r.mode}  ${r.playerCount}/${r.maxPlayers}  ${r.theme}  ${r.hostName.slice(0, 8)}`,
          10,
          y + 9,
          PAL.paper,
          6,
        );
      });
      if (!list.length) centerText(ctx, "No open rooms — create one!", 120, PAL.accent, 7);
      if (lastErr) centerText(ctx, lastErr, 210, PAL.danger, 7);
      if (creating) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
        ctx.fillStyle = PAL.ui;
        ctx.fillRect(28, 40, 200, 150);
        centerText(ctx, "CREATE ROOM", 56, PAL.gold, 9);
        drawText(ctx, `Name: ${opts.name}`, 40, 76);
        drawText(ctx, `Size: ${opts.size}p   Theme: ${opts.theme}`, 40, 92);
        drawText(ctx, `${opts.public ? "PUBLIC" : "PRIVATE"}  FT${opts.roundsToWin}  bots:${opts.botFill ? "on" : "off"}`, 40, 108);
        drawText(ctx, "S size  T theme  P public  R rounds", 40, 130, PAL.paper, 6);
        drawText(ctx, "B botfill  Enter create  Esc cancel", 40, 142, PAL.paper, 6);
      }
    },
    click(x, y) {
      if (creating) return;
      const b = buttons.find((bt) => hit(bt, x, y));
      if (b?.id === "back") go("menu");
      if (b?.id === "refresh") net.send({ type: "room_list_request" });
      if (b?.id === "create") creating = true;
      if (b?.id === "code") {
        const code = prompt("Room code?");
        if (code) net.send({ type: "join_room", code: code.toUpperCase() });
      }
      const list = rooms.filter((r) => filter === "all" || r.mode === filter);
      list.slice(0, 10).forEach((r, i) => {
        const yy = 50 + i * 14;
        if (y >= yy && y <= yy + 13 && x >= 8 && x <= 248) {
          audio.click();
          net.send({ type: "join_room", code: r.code });
        }
      });
    },
    key(e) {
      if (e.code === "Escape") {
        if (creating) creating = false;
        else go("menu");
        return;
      }
      if (creating) {
        if (e.code === "KeyS") opts.size = opts.size === 2 ? 4 : 2;
        if (e.code === "KeyT") {
          const th = ["backyard", "beach", "pool", "random"] as const;
          opts.theme = th[(th.indexOf(opts.theme) + 1) % th.length]!;
        }
        if (e.code === "KeyP") opts.public = !opts.public;
        if (e.code === "KeyR") opts.roundsToWin = opts.roundsToWin === 2 ? 3 : opts.roundsToWin === 3 ? 5 : 2;
        if (e.code === "KeyB") opts.botFill = !opts.botFill;
        if (e.code === "Enter") {
          net.send({ type: "create_room", opts });
          creating = false;
        }
        return;
      }
      if (e.code === "Digit1") filter = "all";
      if (e.code === "Digit2") filter = "duel";
      if (e.code === "Digit3") filter = "ffa";
    },
    leave() {
      unsub();
    },
  };
}
