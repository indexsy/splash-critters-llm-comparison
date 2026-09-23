// Animated 8-bit backdrop painted on the frame canvas behind the menu overlay: a drifting
// dotted pattern, rising bubbles and a strip of rolling water along the bottom edge. It shows
// through the gaps around panels so every menu screen shares one living background.
import { frame } from '../../frame';
import { PAL } from '../../render/palette';
import { hashInts } from '../../render/pixelart';
import { TILE, WATER_FRAMES, WATER_FRAME_MS, drawWater } from '../../render/tiles';
import type { Scope } from './scope';

const FRAME_MS = 1000 / 30;
const WATER_ROWS = 1;
const BUBBLES = 14;
const DOT_STEP = 8;

interface Bubble {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
}

function makeBubbles(): Bubble[] {
  return Array.from({ length: BUBBLES }, (_, i) => ({
    x: hashInts(i, 7) % frame.W,
    y: hashInts(i, 11) % frame.H,
    speed: 6 + (hashInts(i, 13) % 10),
    size: 1 + (hashInts(i, 17) % 2),
    phase: (hashInts(i, 19) % 628) / 100,
  }));
}

function drawDots(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = PAL.navy;
  ctx.fillRect(0, 0, frame.W, frame.H);
  const shift = Math.floor(t / 120) % DOT_STEP;
  ctx.fillStyle = PAL.slate;
  for (let y = -DOT_STEP; y < frame.H; y += DOT_STEP) {
    for (let x = -DOT_STEP; x < frame.W; x += DOT_STEP) {
      const odd = ((x + y) / DOT_STEP) & 1;
      if (odd) ctx.fillRect(x + shift, y + shift, 1, 1);
    }
  }
}

function drawBubbles(ctx: CanvasRenderingContext2D, bubbles: Bubble[], t: number): void {
  const top = frame.H - WATER_ROWS * TILE;
  for (const b of bubbles) {
    const travel = (b.y - (t / 1000) * b.speed) % top;
    const y = Math.round(travel < 0 ? travel + top : travel);
    const x = Math.round(b.x + Math.sin(t / 700 + b.phase) * 2);
    ctx.fillStyle = PAL.skyLight;
    ctx.fillRect(x, y, b.size, b.size);
    if (b.size > 1) {
      ctx.fillStyle = PAL.foam;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawWaterStrip(ctx: CanvasRenderingContext2D, t: number): void {
  const waterFrame = Math.floor(t / WATER_FRAME_MS) % WATER_FRAMES;
  const scroll = Math.floor(t / 90) % TILE;
  const y0 = frame.H - WATER_ROWS * TILE;
  for (let row = 0; row < WATER_ROWS; row++) {
    for (let x = -TILE; x < frame.W + TILE; x += TILE) drawWater(ctx, x - scroll, y0 + row * TILE, waterFrame);
  }
  ctx.fillStyle = PAL.foam;
  for (let x = 0; x < frame.W; x += 2) {
    const crest = Math.round(Math.sin(t / 400 + x / 9) * 1.5);
    ctx.fillRect(x, y0 - 1 + crest, 2, 1);
  }
}

/** Paint the backdrop every frame (30 fps) until `scope` is disposed. */
export function runMenuBackdrop(scope: Scope): void {
  const bubbles = makeBubbles();
  let last = -Infinity;
  const paint = (now: number) => {
    if (now - last < FRAME_MS) return;
    last = now;
    const ctx = frame.ctx;
    drawDots(ctx, now);
    drawBubbles(ctx, bubbles, now);
    drawWaterStrip(ctx, now);
  };
  paint(performance.now());
  scope.loop(paint);
}
