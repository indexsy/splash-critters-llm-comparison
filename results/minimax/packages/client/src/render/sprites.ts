import type { AnimalId, HatId, PowerupId, Theme } from '@splash-critters/shared';

/** All art in Splash Critters is procedural pixel data - no external assets. */

export const PALETTE = {
  ink: '#10182b',
  deep: '#16213e',
  night: '#1b2947',
  sky: '#7ec8e3',
  water: '#3aa6d8',
  waterLight: '#8fd8f0',
  foam: '#e8f7ff',
  sand: '#e8c88f',
  sandDark: '#c9a463',
  grass: '#5aa64f',
  grassDark: '#3c7a3c',
  wood: '#8b5a2b',
  stone: '#7d8794',
  stoneDark: '#4a5261',
  white: '#fdf6e3',
  cream: '#f6e7c1',
  orange: '#f4a261',
  pink: '#e76f51',
  mint: '#2a9d8f',
  yellow: '#f7d14b',
  black: '#0b1120',
} as const;

type Palette = Record<string, string>;

const CRITTER: string[] = [
  '....oooo....',
  '...obbbbbo..',
  '..obllllbbo.',
  '..obweewbbo.',
  '..obwkewkbo.',
  '..obbbbbbbo.',
  '..obwwwwwbo.',
  '.obbbbbbbbo.',
  '.obbbbbbbbo.',
  '..obbbbbbbo.',
  '...oaaaao...',
  '............',
];

const CRITTER_FRAME2: string[] = [
  '....oooo....',
  '...obbbbbo..',
  '..obllllbbo.',
  '..obweewbbo.',
  '..obwkewkbo.',
  '..obbbbbbbo.',
  '..obwwwwwbo.',
  '.obbbbbbbbo.',
  '.obbbbbbbbo.',
  '..obbbbbbbo.',
  '...oaa.aao..',
  '............',
];

const ANIMAL_PALETTES: Record<AnimalId, Palette> = {
  frog: { o: '#1f6b2b', b: '#4caf50', l: '#8bd45c', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#e8a04c', s: '#3f8f3f' },
  duck: { o: '#a8791a', b: '#f7d14b', l: '#ffe98a', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#f08a3c', s: '#d9a520' },
  otter: { o: '#4a2c12', b: '#8b5a2b', l: '#c08a52', w: '#f0c9a0', e: '#ffffff', k: '#10182b', a: '#f0c9a0', s: '#6b421f' },
  penguin: { o: '#131c33', b: '#2b3a67', l: '#4a5f96', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#f4a261', s: '#1c2542' },
  cat: { o: '#8a4b1d', b: '#f0913f', l: '#f8c07a', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#ffd9c0', s: '#f4a261' },
  raccoon: { o: '#3d4459', b: '#8f9bb3', l: '#c3cbdb', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#f0c9a0', s: '#2f3547' },
  turtle: { o: '#33502a', b: '#6aa84f', l: '#a3c585', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#8a6b3d', s: '#8a6b3d' },
  capybara: { o: '#6d523a', b: '#c39a6b', l: '#e0bd93', w: '#fdf6e3', e: '#ffffff', k: '#10182b', a: '#e8c9a0', s: '#a87f52' },
};

const HATS: Record<HatId, string[]> = {
  none: ['............', '............', '............', '............'],
  bucket_hat: [
    '....oooo....',
    '...oCCCCo...',
    '..oCCCCCCo..',
    '.oooooooooo.',
  ],
  snorkel: [
    '..oMMMoo....',
    '.oMMMMMMo...',
    '..oMMMoo.o.o',
    '....oTTT....',
  ],
  crown: [
    '..o.o.o.o...',
    '.oCoCoCoCo..',
    '.oCCCCCCCo..',
    '..ooooooo...',
  ],
  bandana: [
    '....oooo....',
    '..oRRRRRRo..',
    '.oRRRRRRRRo.',
    '..oRRo......',
  ],
  propeller: [
    '....pPp.....',
    '...oCCCo....',
    '..oCCCCCCo..',
    '....ooo.....',
  ],
};

const HAT_PALETTES: Record<HatId, Palette> = {
  none: {},
  bucket_hat: { C: '#f7d14b', o: '#a8791a' },
  snorkel: { M: '#3aa6d8', T: '#f4a261', o: '#16213e' },
  crown: { C: '#f7d14b', o: '#a8791a' },
  bandana: { R: '#e76f51', o: '#8c2f1c' },
  propeller: { C: '#e76f51', p: '#fdf6e3', o: '#16213e' },
};

export const TILE = 16;

function drawPixelMap(
  ctx: CanvasRenderingContext2D,
  map: string[],
  palette: Palette,
  x: number,
  y: number,
  flip = false,
): void {
  const w = map[0]?.length ?? 0;
  for (let row = 0; row < map.length; row++) {
    const line = map[row];
    for (let col = 0; col < line.length; col++) {
      const key = line[col];
      if (key === '.' || key === ' ') continue;
      const color = palette[key];
      if (!color) continue;
      const px = flip ? x + (w - 1 - col) : x + col;
      ctx.fillStyle = color;
      ctx.fillRect(px, y + row, 1, 1);
    }
  }
}

export function drawCritter(
  ctx: CanvasRenderingContext2D,
  animal: AnimalId,
  x: number,
  y: number,
  frame: number,
  facing: number,
  options: { flash?: boolean; soak?: number } = {},
): void {
  const palette = ANIMAL_PALETTES[animal];
  const map = frame % 2 === 0 ? CRITTER : CRITTER_FRAME2;
  const flip = facing === 2; // looking left
  if (options.soak !== undefined && options.soak > 0) {
    // the dramatic soak: the critter turns blue and squashes
    const squashed = Math.min(1, options.soak);
    ctx.save();
    ctx.translate(x + 6, y + 11);
    ctx.scale(1 + squashed * 0.25, 1 - squashed * 0.45);
    ctx.translate(-(x + 6), -(y + 11));
    drawPixelMap(ctx, map, { ...palette, b: '#3a7bd5', l: '#6fa8e8', w: '#bfe3ff' }, x, y, flip);
    ctx.restore();
    return;
  }
  drawPixelMap(ctx, map, palette, x, y, flip);
  if (options.flash) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 12, 12);
    ctx.globalAlpha = 1;
  }
}

export function drawHat(ctx: CanvasRenderingContext2D, hat: HatId, x: number, y: number): void {
  if (hat === 'none') return;
  const map = HATS[hat];
  drawPixelMap(ctx, map, HAT_PALETTES[hat], x, y - 3);
}

/** Small square portrait used in the HUD, the lobby and the locker. */
export function drawAnimalIcon(
  ctx: CanvasRenderingContext2D,
  animal: AnimalId,
  x: number,
  y: number,
  frame = 0,
): void {
  drawCritter(ctx, animal, x, y, frame, 0);
}

export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fuse: number,
  frame: number,
  revenge = false,
): void {
  const wobble = Math.sin(frame * 0.6) > 0 ? 0 : 1;
  const inflate = fuse < 22 ? 1 + Math.sin(fuse * 0.9) * 0.12 : 1;
  const cx = x + 8;
  const cy = y + 7;
  const r = 5 * inflate;
  ctx.fillStyle = revenge ? '#f7d14b' : PALETTE.water;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = revenge ? '#a8791a' : '#1f6f9c';
  ctx.fillRect(cx - 1, cy + r - 1, 2, 2);
  ctx.fillStyle = PALETTE.foam;
  ctx.fillRect(cx - 3 + wobble, cy - 3, 2, 2);
  ctx.fillStyle = revenge ? '#c99a20' : '#2b86bd';
  ctx.fillRect(cx - 2, cy + r, 4, 1);
}

export function drawSplash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  dir: number,
  progress: number,
  colorblind: boolean,
): void {
  const color = colorblind ? '#ffe14d' : PALETTE.foam;
  const edge = colorblind ? '#ff8c00' : PALETTE.waterLight;
  const steps = Math.max(1, Math.round(len * progress));
  for (let step = 1; step <= steps; step++) {
    const px = x + 8 + [0, step, 0, -step][dir];
    const py = y + 8 + [-step, 0, step, 0][dir];
    const size = step === steps ? 4 : 3;
    ctx.fillStyle = step % 2 === 0 ? color : edge;
    ctx.fillRect(px - (size >> 1), py - (size >> 1), size, size);
  }
}

export function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PALETTE.sandDark;
  ctx.fillRect(x + 2, y + 6, 12, 8);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(x + 3, y + 5, 10, 8);
  // battlements
  ctx.fillRect(x + 3, y + 3, 3, 3);
  ctx.fillRect(x + 8, y + 3, 3, 3);
  ctx.fillStyle = PALETTE.sandDark;
  ctx.fillRect(x + 6, y + 9, 4, 5);
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(x + 7, y + 10, 1, 1);
}

export function drawBoulder(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PALETTE.stoneDark;
  ctx.fillRect(x + 2, y + 3, 12, 11);
  ctx.fillStyle = PALETTE.stone;
  ctx.fillRect(x + 3, y + 2, 10, 11);
  ctx.fillStyle = '#98a3b0';
  ctx.fillRect(x + 5, y + 4, 3, 2);
  ctx.fillRect(x + 10, y + 7, 2, 2);
  ctx.fillStyle = PALETTE.stoneDark;
  ctx.fillRect(x + 4, y + 11, 8, 2);
}

export function drawDuckToy(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, frame: number): void {
  const bob = Math.sin(frame * 0.2) > 0 ? 0 : 1;
  ctx.fillStyle = PALETTE.yellow;
  ctx.fillRect(x + 3, y + 5 + bob, 10, 6);
  ctx.fillRect(x + 5, y + 2 + bob, 6, 4);
  ctx.fillStyle = PALETTE.orange;
  ctx.fillRect(x + 5 + (dir === 2 ? 0 : 8), y + 3 + bob, 4, 2);
  ctx.fillStyle = PALETTE.black;
  ctx.fillRect(x + 7, y + 3 + bob, 1, 1);
  ctx.fillStyle = PALETTE.pink;
  ctx.fillRect(x + 9, y + 8 + bob, 2, 2);
}

const POWERUP_COLORS: Record<PowerupId, { base: string; dark: string }> = {
  extra_balloon: { base: PALETTE.water, dark: '#1f6f9c' },
  big_splash: { base: PALETTE.waterLight, dark: PALETTE.water },
  flippers: { base: PALETTE.orange, dark: '#b56a2f' },
  boots: { base: PALETTE.mint, dark: '#1c6b60' },
};

export function drawPowerup(
  ctx: CanvasRenderingContext2D,
  kind: PowerupId,
  x: number,
  y: number,
  frame: number,
): void {
  const colors = POWERUP_COLORS[kind];
  const bob = Math.sin(frame * 0.15) > 0 ? 0 : 1;
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(x + 2, y + 2 + bob, 12, 12);
  ctx.fillStyle = colors.base;
  ctx.fillRect(x + 3, y + 3 + bob, 10, 10);
  ctx.fillStyle = colors.dark;
  switch (kind) {
    case 'extra_balloon':
      ctx.fillRect(x + 6, y + 5 + bob, 4, 6);
      ctx.fillRect(x + 5, y + 11 + bob, 6, 1);
      break;
    case 'big_splash':
      ctx.fillRect(x + 7, y + 4 + bob, 2, 9);
      ctx.fillRect(x + 4, y + 7 + bob, 8, 2);
      break;
    case 'flippers':
      ctx.fillRect(x + 4, y + 8 + bob, 8, 2);
      ctx.fillRect(x + 4, y + 10 + bob, 3, 2);
      ctx.fillRect(x + 9, y + 10 + bob, 3, 2);
      break;
    case 'boots':
      ctx.fillRect(x + 4, y + 7 + bob, 3, 6);
      ctx.fillRect(x + 9, y + 7 + bob, 3, 6);
      ctx.fillRect(x + 3, y + 11 + bob, 5, 2);
      ctx.fillRect(x + 8, y + 11 + bob, 5, 2);
      break;
  }
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(x + 4, y + 4 + bob, 1, 1);
}

export interface ThemeColors {
  floor: string;
  floorAlt: string;
  detail: string;
  border: string;
}

export const THEMES: Record<Theme, ThemeColors> = {
  backyard: { floor: PALETTE.grass, floorAlt: PALETTE.grassDark, detail: '#7cc46f', border: '#8b5a2b' },
  beach: { floor: PALETTE.sand, floorAlt: PALETTE.sandDark, detail: '#f4e2b6', border: '#5f9ea0' },
  pool: { floor: '#4aa3c7', floorAlt: '#3a86ab', detail: '#8fd8f0', border: '#fdf6e3' },
};

export function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  tx: number,
  ty: number,
  frame: number,
): void {
  const colors = THEMES[theme];
  const alt = (tx + ty) % 2 === 0;
  ctx.fillStyle = alt ? colors.floor : colors.floorAlt;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = colors.detail;
  if (theme === 'backyard') {
    if ((tx * 7 + ty * 13) % 11 === 0) {
      ctx.fillRect(x + 6, y + 6, 2, 3);
      ctx.fillRect(x + 7, y + 5, 1, 1);
    }
  } else if (theme === 'beach') {
    if ((tx * 5 + ty * 3) % 9 === 0) {
      ctx.fillRect(x + 5, y + 8, 3, 2);
      ctx.fillStyle = '#e76f51';
      ctx.fillRect(x + 6, y + 8, 1, 1);
    }
  } else {
    const shimmer = (frame + tx * 3 + ty * 5) % 20;
    if (shimmer < 3) {
      ctx.fillRect(x + 3 + shimmer, y + 4, 3, 1);
    }
  }
}

export function drawBorderTile(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  x: number,
  y: number,
  horizontal: boolean,
): void {
  const colors = THEMES[theme];
  ctx.fillStyle = colors.border;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  if (horizontal) {
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    for (let i = 0; i < TILE; i += 4) ctx.fillRect(x + i, y + 2, 2, 6);
  } else {
    ctx.fillRect(x + TILE - 3, y, 3, TILE);
    for (let i = 0; i < TILE; i += 4) ctx.fillRect(x + 2, y + i, 6, 2);
  }
}
