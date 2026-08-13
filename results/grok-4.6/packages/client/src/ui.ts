import { CONFIG } from "@splash/shared";
import { PAL } from "./render/sprites.js";

export interface Btn {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  id: string;
}

export function hit(b: Btn, x: number, y: number): boolean {
  return x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
}

export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = PAL.ui;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PAL.gold;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function drawBtn(ctx: CanvasRenderingContext2D, b: Btn, hover = false): void {
  ctx.fillStyle = hover ? PAL.accent : PAL.ink;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = PAL.paper;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  ctx.fillStyle = PAL.paper;
  ctx.font = "8px monospace";
  const tw = ctx.measureText(b.label).width;
  ctx.fillText(b.label, b.x + (b.w - tw) / 2, b.y + b.h / 2 + 3);
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = PAL.paper, size = 8): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px monospace`;
  ctx.fillText(text, x, y);
}

export function centerText(ctx: CanvasRenderingContext2D, text: string, y: number, color = PAL.paper, size = 8): void {
  ctx.font = `${size}px monospace`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = color;
  ctx.fillText(text, (CONFIG.INTERNAL_W - w) / 2, y);
}

export function scalePoint(canvas: HTMLCanvasElement, ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * CONFIG.INTERNAL_W,
    y: ((ev.clientY - r.top) / r.height) * CONFIG.INTERNAL_H,
  };
}
