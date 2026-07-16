import type { AnimalId, Dir, HatId, MapTheme } from '@splash/shared';

// NES-ish palette
export const PAL = {
  black: '#0f0f1a',
  white: '#f8f8f8',
  gray: '#7a7a8a',
  dark: '#2a2a3a',
  green: '#3cb043',
  darkGreen: '#2d6a2e',
  grass: '#5cad4a',
  sand: '#e8c87a',
  sandDark: '#c4a04a',
  water: '#3a8fd4',
  waterDeep: '#1a5a9a',
  waterLight: '#7ec8f0',
  pink: '#f48fb1',
  orange: '#ff9800',
  yellow: '#ffd54f',
  brown: '#8d6e63',
  red: '#e53935',
  purple: '#7e57c2',
  pool: '#4fc3f7',
  poolTile: '#29b6f6',
  wood: '#a1887f',
  castle: '#d7ccc8',
  castleDark: '#a1887f',
};

export const ANIMAL_COLORS: Record<AnimalId, { body: string; accent: string; eye: string }> = {
  frog: { body: '#4caf50', accent: '#2e7d32', eye: '#fff' },
  duck: { body: '#ffd54f', accent: '#ff9800', eye: '#222' },
  otter: { body: '#8d6e63', accent: '#5d4037', eye: '#fff' },
  penguin: { body: '#37474f', accent: '#eceff1', eye: '#fff' },
  cat: { body: '#ffb74d', accent: '#e65100', eye: '#222' },
  raccoon: { body: '#78909c', accent: '#37474f', eye: '#fff' },
  turtle: { body: '#66bb6a', accent: '#33691e', eye: '#222' },
  capybara: { body: '#a1887f', accent: '#6d4c41', eye: '#222' },
};

export function themeColors(theme: MapTheme) {
  switch (theme) {
    case 'beach':
      return { floor: PAL.sand, floorAlt: PAL.sandDark, wall: '#5d4037', accent: '#81d4fa' };
    case 'pool':
      return { floor: PAL.poolTile, floorAlt: PAL.pool, wall: '#1565c0', accent: '#fff59d' };
    default:
      return { floor: PAL.grass, floorAlt: PAL.darkGreen, wall: PAL.wood, accent: '#a5d6a7' };
  }
}

/** Draw 8x8 animal facing dir, frame 0|1 walk */
export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  animal: AnimalId,
  hat: HatId,
  dir: Dir,
  frame: number,
  scale = 1,
): void {
  const c = ANIMAL_COLORS[animal];
  const s = scale;
  ctx.save();
  ctx.translate(x, y);

  // Body
  ctx.fillStyle = c.body;
  ctx.fillRect(-4 * s, -3 * s, 8 * s, 7 * s);

  // Belly accent
  ctx.fillStyle = c.accent;
  ctx.fillRect(-2 * s, 0, 4 * s, 3 * s);

  // Eyes
  ctx.fillStyle = c.eye;
  const eyeY = -1 * s;
  if (dir === 'left') {
    ctx.fillRect(-3 * s, eyeY, 2 * s, 2 * s);
  } else if (dir === 'right') {
    ctx.fillRect(1 * s, eyeY, 2 * s, 2 * s);
  } else {
    ctx.fillRect(-3 * s, eyeY, 2 * s, 2 * s);
    ctx.fillRect(1 * s, eyeY, 2 * s, 2 * s);
  }
  ctx.fillStyle = '#111';
  if (dir === 'left') ctx.fillRect(-3 * s, eyeY, 1 * s, 1 * s);
  else if (dir === 'right') ctx.fillRect(2 * s, eyeY, 1 * s, 1 * s);
  else {
    ctx.fillRect(-2 * s, eyeY, 1 * s, 1 * s);
    ctx.fillRect(2 * s, eyeY, 1 * s, 1 * s);
  }

  // Walk bob
  if (frame === 1) {
    ctx.fillStyle = c.body;
    ctx.fillRect(-5 * s, 3 * s, 2 * s, 2 * s);
    ctx.fillRect(3 * s, 3 * s, 2 * s, 2 * s);
  } else {
    ctx.fillStyle = c.body;
    ctx.fillRect(-4 * s, 3 * s, 2 * s, 2 * s);
    ctx.fillRect(2 * s, 3 * s, 2 * s, 2 * s);
  }

  // Special: cat ears, duck bill, etc.
  if (animal === 'cat' || animal === 'raccoon') {
    ctx.fillStyle = c.body;
    ctx.fillRect(-4 * s, -5 * s, 2 * s, 2 * s);
    ctx.fillRect(2 * s, -5 * s, 2 * s, 2 * s);
  }
  if (animal === 'duck') {
    ctx.fillStyle = '#ff9800';
    ctx.fillRect(dir === 'left' ? -6 * s : 2 * s, 0, 3 * s, 2 * s);
  }
  if (animal === 'penguin') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-2 * s, 0, 4 * s, 4 * s);
  }

  // Hat
  drawHat(ctx, hat, s);
  ctx.restore();
}

function drawHat(ctx: CanvasRenderingContext2D, hat: HatId, s: number): void {
  switch (hat) {
    case 'bucket':
      ctx.fillStyle = '#fdd835';
      ctx.fillRect(-5 * s, -6 * s, 10 * s, 2 * s);
      ctx.fillRect(-3 * s, -8 * s, 6 * s, 2 * s);
      break;
    case 'snorkel':
      ctx.fillStyle = '#29b6f6';
      ctx.fillRect(3 * s, -4 * s, 2 * s, 5 * s);
      ctx.fillStyle = '#eee';
      ctx.fillRect(-3 * s, -2 * s, 6 * s, 2 * s);
      break;
    case 'crown':
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(-3 * s, -7 * s, 6 * s, 2 * s);
      ctx.fillRect(-3 * s, -9 * s, 1 * s, 2 * s);
      ctx.fillRect(0, -9 * s, 1 * s, 2 * s);
      ctx.fillRect(2 * s, -9 * s, 1 * s, 2 * s);
      break;
    case 'bandana':
      ctx.fillStyle = '#e53935';
      ctx.fillRect(-4 * s, -5 * s, 8 * s, 2 * s);
      ctx.fillRect(3 * s, -4 * s, 3 * s, 2 * s);
      break;
    case 'propeller':
      ctx.fillStyle = '#42a5f5';
      ctx.fillRect(-2 * s, -7 * s, 4 * s, 2 * s);
      ctx.fillStyle = '#ef5350';
      ctx.fillRect(-5 * s, -8 * s, 10 * s, 1 * s);
      break;
  }
}

export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tick: number,
  placeTick: number,
  fuseTicks: number,
): void {
  const age = tick - placeTick;
  const progress = Math.min(1, age / fuseTicks);
  const wobble = Math.sin(tick * 0.3) * (1 + progress);
  const inflate = 3 + progress * 2 + Math.abs(wobble) * 0.3;

  ctx.fillStyle = '#42a5f5';
  ctx.beginPath();
  ctx.ellipse(x, y - 1, inflate, inflate + 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#90caf9';
  ctx.fillRect(x - 1, y - inflate, 2, 2);
  // Fuse warning flash
  if (progress > 0.7 && Math.floor(tick / 3) % 2 === 0) {
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(x, y - 1, inflate, inflate + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

export function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number, tile: number): void {
  ctx.fillStyle = PAL.castle;
  ctx.fillRect(x + 1, y + 2, tile - 2, tile - 3);
  ctx.fillStyle = PAL.castleDark;
  ctx.fillRect(x + 1, y + 1, 3, 3);
  ctx.fillRect(x + tile - 4, y + 1, 3, 3);
  ctx.fillRect(x + tile / 2 - 1.5, y, 3, 3);
  // Door
  ctx.fillStyle = '#6d4c41';
  ctx.fillRect(x + tile / 2 - 2, y + tile - 5, 4, 4);
}

export function drawBoulder(ctx: CanvasRenderingContext2D, x: number, y: number, tile: number, theme: MapTheme): void {
  const tc = themeColors(theme);
  ctx.fillStyle = tc.wall;
  ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
  ctx.fillStyle = '#00000033';
  ctx.fillRect(x + 2, y + tile - 4, tile - 4, 2);
}

export function drawPowerup(ctx: CanvasRenderingContext2D, x: number, y: number, type: string, tick: number): void {
  const bob = Math.sin(tick * 0.15) * 1.5;
  const colors: Record<string, string> = {
    extraBalloon: '#42a5f5',
    bigSplash: '#26c6da',
    flippers: '#66bb6a',
    rubberBoots: '#ef5350',
  };
  ctx.fillStyle = colors[type] ?? '#fff';
  ctx.fillRect(x - 4, y - 4 + bob, 8, 8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 2, y - 2 + bob, 3, 3);
  // Icon letter
  ctx.fillStyle = '#111';
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  const letter = type === 'extraBalloon' ? 'B' : type === 'bigSplash' ? 'S' : type === 'flippers' ? 'F' : 'K';
  ctx.fillText(letter, x, y + 2 + bob);
}

export function drawSplashTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  age: number,
  colorblind: boolean,
): void {
  const alpha = Math.max(0.2, 1 - age / 12);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colorblind ? '#e040fb' : PAL.waterLight;
  ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
  ctx.fillStyle = colorblind ? '#ea80fc' : PAL.water;
  ctx.fillRect(x + 3, y + 3, tile - 6, tile - 6);
  ctx.globalAlpha = 1;
}

export function drawDuck(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#ffeb3b';
  ctx.fillRect(x - 4, y - 2, 8, 5);
  ctx.fillStyle = '#ff9800';
  ctx.fillRect(x + 2, y - 1, 3, 2);
  ctx.fillStyle = '#111';
  ctx.fillRect(x - 1, y - 1, 1, 1);
}
