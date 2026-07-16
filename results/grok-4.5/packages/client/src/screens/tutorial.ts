import { pixelBg, text, W, H, panel } from './common.js';

const STEPS = [
  'Welcome! Move with WASD or Arrow keys.',
  'Drop a water balloon with Space or E.',
  'Balloons burst in a cross — wash sandcastles!',
  'Grab power-ups for more balloons, splash, speed.',
  'Chain balloons for DOUBLE SPLASH!',
  'Soak the enemy to win. Last critter dry wins!',
  'Press Enter to start a practice bout vs Easy bot.',
];

export function drawTutorial(
  ctx: CanvasRenderingContext2D,
  tick: number,
  step: number,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'HOW TO PLAY', W / 2, 20, '#4fc3f7', 12, 'center');
  panel(ctx, 20, 40, W - 40, 120);

  STEPS.forEach((s, i) => {
    const y = 58 + i * 14;
    const active = i === step;
    text(ctx, `${i + 1}. ${s}`, 30, y, active ? '#fff59d' : i < step ? '#4caf50' : '#666', 5);
  });

  text(ctx, '[Enter] Next / Start   [Esc] Skip', W / 2, H - 16, '#888', 6, 'center');
}

export { STEPS };
