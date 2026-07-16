import { pixelBg, text, W, H } from './common.js';

export function drawHowto(ctx: CanvasRenderingContext2D, tick: number): void {
  pixelBg(ctx, tick);
  text(ctx, 'HOW TO PLAY', W / 2, 16, '#4fc3f7', 10, 'center');
  const lines = [
    'WASD / Arrows — Move',
    'Space / E — Drop water balloon',
    '1-4 — Emotes',
    '',
    'Balloons burst in a CROSS after 3s.',
    'Splash washes sandcastles & soaks foes.',
    'Chain balloons for combo splashes!',
    '',
    'Power-ups hide in castles:',
    '  B Extra Balloon  S Big Splash',
    '  F Flippers (speed)  K Rubber Boots (kick)',
    '',
    'At 2:00 — Rising Tide floods the arena!',
    'Last critter dry wins the round.',
    'First to N rounds wins the match.',
  ];
  lines.forEach((l, i) => text(ctx, l, 20, 34 + i * 10, '#ccc', 6));
  text(ctx, '[Esc] Back', W / 2, H - 10, '#888', 6, 'center');
}
