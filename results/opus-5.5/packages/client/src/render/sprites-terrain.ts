// Arena obstacle art per theme: sandcastles (+4 crumble frames), pillar boulders and the
// border ring pieces. Themes are pure reskins: same shapes, colours from THEME_PALETTES.
// Castles, crumbles and pillars are transparent overlays drawn over a floor tile; border
// pieces are opaque full tiles.
import type { Theme } from '@splash/shared';
import { PAL, THEME_PALETTES, type ThemePalette } from './palette';
import { PixelGrid, cached, type Legend } from './pixelart';

export type BorderPiece = 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br';
export const CASTLE_CRUMBLE_FRAMES = 4;
/** Pillar art variants per theme (pool alternates floaties and ladders). */
export const PILLAR_VARIANTS = 2;

// ---------------------------------------------------------------------------------------
// Sandcastle
// ---------------------------------------------------------------------------------------

const CASTLE_ROWS = [
  '........ff......',
  '.......pfff.....',
  '.......p........',
  '....L.LLLL.L....',
  '....LLLLLLLL....',
  '....MMMMMMMD....',
  '....MMMddMMD....',
  '.L.LMMMMMMMDL.L.',
  '.LLLMMMMMMMDLLL.',
  '.MMMMMMMMMMMMMD.',
  '.MMsMMMMMMMsMMD.',
  '.MMMMMkkkMMMMMD.',
  '.MsMMkkkkkMMsMD.',
  '.MMMMkkkkkMMMMD.',
  '.DDDDDDDDDDDDDD.',
  '................',
];

function castleLegend(t: ThemePalette): Legend {
  return {
    L: t.castleLight,
    M: t.castleMid,
    D: t.castleDark,
    s: t.castleDark,
    d: PAL.brownDark,
    k: PAL.brownDark,
    f: t.castleFlag,
    p: PAL.brown,
  };
}

function castleFill(theme: Theme): PixelGrid {
  return PixelGrid.fromRows(CASTLE_ROWS, castleLegend(THEME_PALETTES[theme]));
}

/** Cached castle overlay (transparent around the castle). */
export function getCastleTile(theme: Theme): HTMLCanvasElement {
  return cached(`castle:${theme}`, () => castleFill(theme).outlined(PAL.ink).toCanvas());
}

/** Debris chunks thrown up while a castle collapses. */
function debris(g: PixelGrid, frame: number, t: ThemePalette): void {
  const spots: [number, number][] = [[2, 6], [13, 5], [5, 3], [11, 2], [1, 10], [14, 9]];
  spots.forEach(([x, y], i) => {
    const yy = y + frame * 2;
    if (yy < 15) g.set(x + (i % 2 === 0 ? -frame : frame), yy, i % 2 === 0 ? t.castleMid : t.castleLight);
  });
}

function mound(rx: number, ry: number, t: ThemePalette): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.ellipse(7.5, 14 - ry, rx, ry, t.castleDark);
  g.ellipse(7, 14 - ry - 0.5, rx - 1, Math.max(0.5, ry - 1), t.castleMid);
  g.ellipse(6, 14 - ry - 1, rx / 3, Math.max(0.5, ry / 3), t.castleLight);
  return g;
}

/** Crumble sequence: cracked + soaked, top collapsing, wet heap, washed-out pile. */
function crumbleFrame(theme: Theme, frame: number): PixelGrid {
  const t = THEME_PALETTES[theme];
  if (frame === 0) {
    const g = castleFill(theme);
    [[5, 5], [6, 6], [6, 7], [9, 9], [10, 10], [10, 11], [3, 11], [12, 12]].forEach(([x, y]) => g.paintOver(x, y, PAL.brownDark));
    for (let y = 9; y < 14; y++) for (let x = 1; x < 15; x++) if ((x + y) % 3 === 0) g.paintOver(x, y, t.castleDark);
    return g.outlined(PAL.ink);
  }
  if (frame === 1) {
    const g = castleFill(theme).crop(0, 0, 16, 16);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) g.set(x, y, null);
    for (let x = 1; x < 15; x++) if (x % 3 !== 1) g.set(x, 9, null);
    const out = g.outlined(PAL.ink);
    debris(out, 0, t);
    return out;
  }
  const g = mound(frame === 2 ? 6.5 : 4, frame === 2 ? 3 : 1, t).outlined(PAL.ink);
  debris(g, frame, t);
  return g;
}

/** Cached castle crumble overlay frame (0..CASTLE_CRUMBLE_FRAMES-1). */
export function getCastleCrumble(theme: Theme, frame: number): HTMLCanvasElement {
  const f = Math.max(0, Math.min(CASTLE_CRUMBLE_FRAMES - 1, frame));
  return cached(`crumble:${theme}:${f}`, () => crumbleFrame(theme, f).toCanvas());
}

// ---------------------------------------------------------------------------------------
// Pillars (indestructible inner boulders)
// ---------------------------------------------------------------------------------------

function rock(t: ThemePalette, accent: string, variant: number): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.ellipse(7.5, 8.5, 6.5, 5.8, t.pillarDark);
  g.ellipse(7, 8, 6, 5.2, t.pillarMid);
  g.ellipse(5.5, 6, 3, 2.2, t.pillarLight);
  g.set(4, 5, PAL.white);
  const cracks = variant === 0 ? [[9, 7], [10, 8], [10, 9], [11, 10]] : [[6, 10], [7, 11], [9, 10], [3, 9]];
  cracks.forEach(([x, y]) => g.paintOver(x, y, t.pillarDark));
  [[8, 3], [9, 3], [10, 4], [3, 7], [12, 6]].forEach(([x, y], i) => {
    if (i % 2 === variant % 2 || i === 0) g.paintOver(x, y, accent);
  });
  return g.outlined(PAL.ink);
}

function floatie(): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.ellipse(7.5, 7.5, 6.5, 6.5, PAL.pink);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.abs(x - y) < 2 || Math.abs(x + y - 15) < 2) g.paintOver(x, y, PAL.white);
  g.ellipse(5, 4.5, 2, 1, PAL.pinkLight);
  g.ellipse(7.5, 7.5, 2.4, 2.4, null);
  return g.outlined(PAL.ink);
}

function ladder(t: ThemePalette): PixelGrid {
  const g = new PixelGrid(16, 16);
  g.rect(1, 2, 14, 12, t.floorShade);
  g.rect(2, 1, 3, 14, PAL.greyLight).rect(11, 1, 3, 14, PAL.greyLight);
  g.vline(2, 1, 14, PAL.white).vline(11, 1, 14, PAL.white);
  g.vline(4, 1, 14, PAL.grey).vline(13, 1, 14, PAL.grey);
  for (const y of [4, 8, 12]) g.hline(5, 10, y, PAL.cloud).hline(5, 10, y + 1, PAL.grey);
  return g.outlined(PAL.ink);
}

function pillarArt(theme: Theme, variant: number): PixelGrid {
  const t = THEME_PALETTES[theme];
  if (theme === 'pool') return variant % 2 === 0 ? floatie() : ladder(t);
  return rock(t, theme === 'backyard' ? PAL.greenDark : PAL.white, variant % 2);
}

/** Cached pillar overlay (garden stone / beach rock / pool floatie or ladder). */
export function getPillarTile(theme: Theme, variant: number): HTMLCanvasElement {
  const v = ((variant % PILLAR_VARIANTS) + PILLAR_VARIANTS) % PILLAR_VARIANTS;
  return cached(`pillar:${theme}:${v}`, () => pillarArt(theme, v).toCanvas());
}

// ---------------------------------------------------------------------------------------
// Border ring
// ---------------------------------------------------------------------------------------

/** Top border edge (outside = up, arena = down) for a theme, as a full opaque tile. */
function borderTop(theme: Theme): PixelGrid {
  const t = THEME_PALETTES[theme];
  const g = new PixelGrid(16, 16);
  if (theme === 'backyard') {
    g.rect(0, 0, 16, 16, t.backdrop);
    for (let p = 0; p < 4; p++) {
      const x = p * 4;
      g.rect(x, 2, 3, 12, t.borderMid).vline(x, 2, 13, t.borderLight).vline(x + 2, 2, 13, t.borderDark);
      g.set(x + 1, 1, t.borderLight).set(x, 2, t.borderMid).set(x + 2, 2, t.borderMid);
      g.set(x + 3, 3, PAL.brownDark);
    }
    g.rect(0, 5, 16, 2, t.borderDark).hline(0, 15, 5, t.borderLight);
    g.rect(0, 10, 16, 2, t.borderDark).hline(0, 15, 10, t.borderLight);
    g.rect(0, 14, 16, 2, t.floorShade);
  } else if (theme === 'beach') {
    g.rect(0, 0, 16, 16, t.floorShade);
    for (const y0 of [1, 8]) {
      g.rect(0, y0, 16, 6, t.borderMid).hline(0, 15, y0, t.borderLight).hline(0, 15, y0 + 5, t.borderDark);
      g.hline(2, 6, y0 + 2, t.borderDark).hline(9, 13, y0 + 3, t.borderDark);
      g.set(y0 === 1 ? 11 : 4, y0 + 2, PAL.brownDark).set(y0 === 1 ? 12 : 5, y0 + 2, PAL.brownDark);
    }
    g.hline(0, 15, 14, t.borderDark).hline(0, 15, 15, t.floorDetail);
  } else {
    g.rect(0, 0, 16, 11, t.borderMid);
    g.vline(7, 0, 10, t.borderDark).hline(0, 15, 5, t.borderDark);
    g.hline(0, 6, 1, PAL.white).hline(8, 15, 6, PAL.white);
    g.rect(0, 11, 16, 3, t.borderLight).hline(0, 15, 13, t.borderDark);
    g.rect(0, 14, 16, 2, PAL.blueDark);
  }
  return g;
}

function borderCorner(theme: Theme): PixelGrid {
  const t = THEME_PALETTES[theme];
  const g = new PixelGrid(16, 16);
  if (theme === 'backyard') {
    g.rect(0, 0, 16, 16, t.backdrop);
    g.rect(3, 2, 10, 13, t.borderDark).rect(4, 3, 8, 11, t.borderMid).rect(4, 3, 8, 2, t.borderLight);
    g.rect(2, 1, 12, 2, t.borderLight).hline(2, 13, 2, t.borderDark);
    g.vline(6, 5, 12, t.borderDark).vline(9, 6, 13, t.borderDark);
  } else if (theme === 'beach') {
    g.rect(0, 0, 16, 16, t.floorShade);
    g.blit(rock(t, PAL.white, 0), 0, 0);
  } else {
    g.rect(0, 0, 16, 16, t.borderMid);
    g.hline(0, 15, 7, t.borderDark).vline(7, 0, 15, t.borderDark);
    g.hline(1, 6, 1, PAL.white).hline(9, 14, 9, PAL.white);
  }
  return g;
}

function borderArt(theme: Theme, piece: BorderPiece): PixelGrid {
  switch (piece) {
    case 'top':
      return borderTop(theme);
    case 'right':
      return borderTop(theme).rotate(1);
    case 'bottom':
      return borderTop(theme).rotate(2);
    case 'left':
      return borderTop(theme).rotate(3);
    default:
      return borderCorner(theme);
  }
}

/** Cached opaque border tile for the ring position `piece`. */
export function getBorderTile(theme: Theme, piece: BorderPiece): HTMLCanvasElement {
  return cached(`border:${theme}:${piece}`, () => borderArt(theme, piece).toCanvas());
}

/** Which border piece sits at ring position (x, y) of a w x h arena. */
export function borderPieceAt(x: number, y: number, w: number, h: number): BorderPiece {
  const top = y === 0;
  const bottom = y === h - 1;
  const left = x === 0;
  const right = x === w - 1;
  if (top && left) return 'tl';
  if (top && right) return 'tr';
  if (bottom && left) return 'bl';
  if (bottom && right) return 'br';
  if (top) return 'top';
  if (bottom) return 'bottom';
  return left ? 'left' : 'right';
}
