import { CONFIG, tierForRating, type PlayerState } from "@splash/shared";
import { PAL } from "./sprites.js";

export function drawHud(
  ctx: CanvasRenderingContext2D,
  players: PlayerState[],
  scores: Record<string, number>,
  ping: number,
  roundNo: number,
  roundsToWin: number,
  localId: string,
): void {
  ctx.fillStyle = PAL.ui;
  ctx.fillRect(0, 0, CONFIG.INTERNAL_W, 18);
  ctx.fillStyle = PAL.paper;
  ctx.font = "7px monospace";
  ctx.fillText(`R${roundNo}  FT${roundsToWin}`, 4, 12);
  ctx.fillText(`${ping | 0}ms`, CONFIG.INTERNAL_W - 28, 12);

  const shown = players.slice(0, 4);
  shown.forEach((p, i) => {
    const x = 48 + i * 52;
    ctx.fillStyle = p.id === localId ? PAL.gold : PAL.paper;
    ctx.fillText((p.nickname ?? "?").slice(0, 7), x, 8);
    ctx.fillStyle = PAL.accent;
    ctx.fillText(`${scores[p.id] ?? 0}`, x, 16);
    ctx.fillStyle = PAL.water2;
    ctx.fillText(`B${p.balloonCount} S${p.splashRange}`, x + 10, 16);
  });
}

export function drawKillFeed(ctx: CanvasRenderingContext2D, lines: { text: string; life: number }[]): void {
  ctx.font = "7px monospace";
  lines.forEach((l, i) => {
    ctx.globalAlpha = Math.min(1, l.life / 20);
    ctx.fillStyle = PAL.paper;
    ctx.fillText(l.text, 4, 28 + i * 9);
  });
  ctx.globalAlpha = 1;
}

export function drawAnnouncer(ctx: CanvasRenderingContext2D, text: string, t: number): void {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, t / 10);
  ctx.fillStyle = PAL.gold;
  ctx.font = "12px monospace";
  const w = ctx.measureText(text).width;
  ctx.fillText(text, (CONFIG.INTERNAL_W - w) / 2, 40);
  ctx.restore();
}

export function drawTierBadge(ctx: CanvasRenderingContext2D, rating: number, x: number, y: number): void {
  const t = tierForRating(rating);
  ctx.fillStyle = PAL.gold;
  ctx.font = "7px monospace";
  ctx.fillText(t.name, x, y);
}
