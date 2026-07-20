/**
 * Low-level 2D canvas helpers. Everything renders into the 256x224 backbuffer
 * which is then integer-scaled with image-rendering: pixelated, so plain
 * fillRect / fillText at small sizes reads as chunky pixel art after upscale.
 */

export const VW = 256;
export const VH = 224;

export function prepare(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = 'middle';
}

export function clear(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VW, VH);
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

export function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

export function ellipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

export type TextAlign = 'left' | 'center' | 'right';

export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: { color?: string; size?: number; align?: TextAlign; bold?: boolean; shadow?: string } = {},
): void {
  const size = opts.size ?? 8;
  ctx.font = `${opts.bold === false ? '' : 'bold '}${size}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = opts.align ?? 'left';
  if (opts.shadow) {
    ctx.fillStyle = opts.shadow;
    ctx.fillText(str, x, y + 1);
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillText(str, x, y);
}

/** Small deterministic hash for tile variants. */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export function withAlpha(ctx: CanvasRenderingContext2D, a: number, fn: () => void): void {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = a;
  fn();
  ctx.globalAlpha = prev;
}
