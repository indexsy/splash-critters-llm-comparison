// hud.ts — draw the in-match HUD: per-player cards with animal, nickname, stats,
// round score, and the kill-feed / announcer text.
import type { ServerMsg } from "@splash/shared";
import { drawCritter } from "./sprites.js";

export interface HudPlayer {
  slot: number;
  nickname: string;
  animal: string;
  alive: boolean;
  soaks: number;
  roundsWon: number;
  speed: number;
  balloonCount: number;
  splashRange: number;
  isLocal: boolean;
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  players: HudPlayer[],
  roundsToWin: number,
  killFeed: { text: string; life: number }[],
) {
  ctx.save();
  // Player cards along the top
  const cardW = 60;
  const startX = (256 - players.length * cardW) / 2;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const x = startX + i * cardW;
    ctx.fillStyle = p.isLocal ? "#ffcd75" : "#29366f";
    ctx.fillRect(x, 0, cardW - 2, 22);
    ctx.fillStyle = "#1a1c2c";
    ctx.fillRect(x + 1, 1, cardW - 4, 20);
    if (!p.alive) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x + 1, 1, cardW - 4, 20);
    }
    // mini critter
    drawCritter(ctx, x + 2, 2, 1, p.animal as any, "none", 0, 1);
    // nickname
    ctx.fillStyle = p.isLocal ? "#ffcd75" : "#f4f4f4";
    ctx.font = "6px 'Courier New'";
    ctx.textBaseline = "top";
    const nick = p.nickname.slice(0, 8);
    ctx.fillText(nick, x + 12, 2);
    // round pips
    ctx.fillStyle = "#ffcd75";
    for (let r = 0; r < roundsToWin; r++) {
      ctx.fillRect(x + 12 + r * 6, 10, 4, 4);
    }
    ctx.fillStyle = "#38b764";
    for (let r = 0; r < p.roundsWon; r++) {
      ctx.fillRect(x + 12 + r * 6, 10, 4, 4);
    }
    // stats
    ctx.fillStyle = "#73eff7";
    ctx.fillText(`B${p.balloonCount} R${p.splashRange} S${p.speed.toFixed(1)}`, x + 2, 16);
    ctx.fillText(`soaks ${p.soaks}`, x + 30, 16);
  }

  // Kill feed bottom-left
  ctx.font = "7px 'Courier New'";
  let y = 224 - 8 - killFeed.length * 8;
  for (const k of killFeed) {
    ctx.fillStyle = `rgba(26,28,44,${Math.min(1, k.life / 30)})`;
    ctx.fillRect(0, y, 200, 8);
    ctx.fillStyle = "#f4f4f4";
    ctx.fillText(k.text, 2, y + 1);
    y += 8;
  }
  ctx.restore();
}

export function drawAnnouncer(ctx: CanvasRenderingContext2D, text: string, scale = 2) {
  ctx.save();
  ctx.font = `bold ${8 * scale}px 'Courier New'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1a1c2c";
  ctx.fillText(text, 128 + 2, 112 + 2);
  ctx.fillStyle = "#ffcd75";
  ctx.fillText(text, 128, 112);
  ctx.restore();
}

export function drawCountdown(ctx: CanvasRenderingContext2D, n: number) {
  drawAnnouncer(ctx, n > 0 ? String(n) : "SPLASH!", 4);
}

export type { ServerMsg };
