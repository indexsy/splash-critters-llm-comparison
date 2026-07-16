import { PAL } from '../render/sprites.js';

export const W = 256;
export const H = 224;

export type ScreenId =
  | 'title'
  | 'tutorial'
  | 'menu'
  | 'browser'
  | 'create'
  | 'join'
  | 'lobby'
  | 'queue'
  | 'game'
  | 'results'
  | 'leaderboard'
  | 'locker'
  | 'settings'
  | 'howto';

export type MenuItem = { label: string; action: string; sub?: string };

export function clear(ctx: CanvasRenderingContext2D, color = PAL.black): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#1a1a2ecc';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  color = PAL.white,
  size = 8,
  align: CanvasTextAlign = 'left',
): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px monospace`;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}

export function drawMenu(
  ctx: CanvasRenderingContext2D,
  title: string,
  items: MenuItem[],
  selected: number,
  y0 = 60,
): void {
  text(ctx, title, W / 2, 28, '#4fc3f7', 12, 'center');
  items.forEach((item, i) => {
    const y = y0 + i * 16;
    const sel = i === selected;
    if (sel) {
      ctx.fillStyle = '#4fc3f733';
      ctx.fillRect(40, y - 10, W - 80, 14);
      text(ctx, '>', 48, y, '#fff59d', 8);
    }
    text(ctx, item.label, W / 2, y, sel ? '#fff59d' : PAL.white, 8, 'center');
    if (item.sub) text(ctx, item.sub, W / 2, y + 8, '#888', 6, 'center');
  });
}

export function pixelBg(ctx: CanvasRenderingContext2D, tick: number): void {
  clear(ctx, '#0d1b2a');
  for (let i = 0; i < 40; i++) {
    const x = (i * 37 + tick * 0.2) % W;
    const y = (i * 53) % H;
    ctx.fillStyle = i % 3 === 0 ? '#1b3a4b' : '#163044';
    ctx.fillRect(x, y, 2, 2);
  }
}
