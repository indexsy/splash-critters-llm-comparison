import { drawAnimal } from '../render/sprites.js';
import { pixelBg, text, W, H } from './common.js';

export function drawTitle(ctx: CanvasRenderingContext2D, tick: number, ready: boolean): void {
  pixelBg(ctx, tick);
  // Water ripple
  ctx.fillStyle = '#1a5a9a44';
  ctx.fillRect(0, H - 40, W, 40);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = '#3a8fd466';
    const wx = ((tick * 0.5 + i * 40) % (W + 20)) - 10;
    ctx.fillRect(wx, H - 30 + Math.sin(tick * 0.1 + i) * 3, 16, 4);
  }

  text(ctx, 'SPLASH', W / 2, 50, '#4fc3f7', 20, 'center');
  text(ctx, 'CRITTERS', W / 2, 72, '#fff59d', 16, 'center');
  text(ctx, '8-bit water balloon battler', W / 2, 90, '#888', 6, 'center');

  const animals = ['frog', 'duck', 'otter', 'penguin'] as const;
  animals.forEach((a, i) => {
    drawAnimal(ctx, 50 + i * 50, 130 + Math.sin(tick * 0.1 + i) * 3, a, 'none', 'down', Math.floor(tick / 10) % 2, 1.5);
  });

  if (ready) {
    const blink = Math.floor(tick / 20) % 2 === 0;
    if (blink) text(ctx, 'Press any key', W / 2, 180, '#fff', 8, 'center');
  } else {
    text(ctx, 'Connecting...', W / 2, 180, '#888', 8, 'center');
  }
  text(ctx, 'v1.0', W - 4, H - 6, '#444', 6, 'right');
}
