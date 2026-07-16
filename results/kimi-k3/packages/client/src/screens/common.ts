import { P, W, H, drawPanel, drawText, drawTextCenter, drawPixelRect } from '../render/sprites.js';

export type ScreenId =
  | 'title'
  | 'tutorial'
  | 'menu'
  | 'browser'
  | 'create'
  | 'lobby'
  | 'queue'
  | 'game'
  | 'results'
  | 'leaderboard'
  | 'locker'
  | 'settings'
  | 'howto'
  | 'joincode';

export interface AppProfile {
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: string;
  selectedHat: string;
  ratings: { mode: string; rating: number; games: number; wins: number; peak: number }[];
  unlocks: string[];
}

export interface Keys {
  down: Set<string>;
  pressed: Set<string>;
}

export function clearPressed(keys: Keys): void {
  keys.pressed.clear();
}

export function btn(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  hover: boolean,
): void {
  drawPixelRect(ctx, x, y, w, h, hover ? '#2a4a6a' : P.ui);
  ctx.strokeStyle = hover ? P.gold : P.accent;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = '8px monospace';
  const tw = ctx.measureText(label).width;
  drawText(ctx, label, x + (w - tw) / 2, y + (h - 8) / 2, hover ? P.gold : P.white);
}

export function hit(mx: number, my: number, x: number, y: number, w: number, h: number): boolean {
  return mx >= x && my >= y && mx < x + w && my < y + h;
}

export function bg(ctx: CanvasRenderingContext2D, t: number): void {
  drawPixelRect(ctx, 0, 0, W, H, P.black);
  for (let i = 0; i < 20; i++) {
    const x = ((i * 37 + t * 0.02) % W);
    const y = (i * 53) % H;
    drawPixelRect(ctx, x, y, 1, 1, P.dark);
  }
}

export { P, W, H, drawPanel, drawText, drawTextCenter, drawPixelRect };
