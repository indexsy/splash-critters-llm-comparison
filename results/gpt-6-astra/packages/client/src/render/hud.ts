import { CONFIG, rankTier } from "@splash/shared";
export function formatTime(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / CONFIG.TICK_RATE));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rating: number,
  scale = 1,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#253e3b";
  ctx.fillRect(3, 0, 10, 2);
  ctx.fillRect(1, 2, 14, 9);
  ctx.fillRect(3, 11, 10, 2);
  ctx.fillRect(6, 13, 4, 2);
  ctx.fillStyle = rankTier(rating).color;
  ctx.fillRect(3, 2, 10, 8);
  ctx.fillRect(5, 10, 6, 2);
  ctx.fillStyle = "#fff9e9";
  ctx.fillRect(7, 3, 2, 7);
  ctx.fillRect(5, 6, 6, 2);
  ctx.restore();
}
