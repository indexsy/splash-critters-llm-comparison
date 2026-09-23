// Rank tier badges (puddle -> tsunami, small 12x12 and large 24x24), emote speech bubbles
// (quack / ribbit / squeak / honk) and the two-line game logo.
import type { EmoteId, TierId } from '@splash/shared';
import { textGrid } from './font';
import { PAL, TIER_COLORS } from './palette';
import { PixelGrid, cached, type Legend } from './pixelart';

// ---------------------------------------------------------------------------------------
// Tier badges
// ---------------------------------------------------------------------------------------

export type BadgeSize = 'small' | 'large';
export const BADGE_SMALL = 12;
export const BADGE_LARGE = 24;

interface TierColors {
  rim: string;
  fill: string;
  emblem: string;
  glow: string;
}

/** Wavy line across [x0, x1] centred on row y (s = pixel scale 1 or 2). */
function waveLine(g: PixelGrid, x0: number, x1: number, y: number, s: number, color: string, phase = 0): void {
  for (let x = x0; x <= x1; x++) {
    const yy = y + Math.round(Math.sin(((x + phase) * Math.PI) / (2 * s)) * (s === 1 ? 0.6 : 1.2));
    for (let t = 0; t < s; t++) g.set(x, yy + t, color);
  }
}

/** 8x8 emblem grids (drawn 2x on large badges): w foam, s sky, b blue, y star. */
const RIVER_SMALL = ['........', '.ww...ww', 'w..w.w..', '....w...', '........', '.bb...bb', 'b..b.b..', '....b...'];
const OCEAN = ['........', '........', '...ww...', '..wssw..', '.wssssww', 'wssssssw', 'ssssssss', 'bbbbbbbb'];
const TSUNAMI = ['..www..y', '.wbbbw..', 'wbw..w..', 'wbw.....', 'wbbw..y.', 'wbbbww..', 'bbbbbbww', 'bbbbbbbb'];
const EMBLEM_LEGEND: Legend = { w: PAL.foam, s: PAL.sky, b: PAL.blue, y: PAL.yellow };

/** Draw an emblem grid scaled by s, centred, only over the badge's inner fill. */
function stampEmblem(g: PixelGrid, n: number, s: number, c: TierColors, rows: readonly string[]): void {
  const src = PixelGrid.fromRows(rows, EMBLEM_LEGEND);
  const art = s === 1 ? src : src.resized(src.w * s, src.h * s);
  const ox = Math.floor((n - art.w) / 2);
  const oy = Math.floor((n - art.h) / 2) + (s === 1 ? 0 : 1);
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) {
      const px = art.get(x, y);
      if (px && g.get(ox + x, oy + y) === c.fill) g.set(ox + x, oy + y, px);
    }
  }
}

type Emblem = (g: PixelGrid, n: number, s: number, c: TierColors) => void;

const EMBLEMS: Record<TierId, Emblem> = {
  puddle: (g, n, s, c) => {
    const cx = (n - 1) / 2;
    g.ellipse(cx, cx + 2 * s, 3 * s, s * 0.8, c.emblem);
    g.rect(Math.round(cx), Math.round(cx - 2 * s), s, 2 * s, c.emblem).rect(Math.round(cx) - s + 1, Math.round(cx - s), 2 * s - 1, s, c.emblem);
  },
  pond: (g, n, s, c) => {
    const cx = (n - 1) / 2;
    g.ellipse(cx, cx + s * 0.5, 3 * s, 2.2 * s, c.emblem);
    for (let i = 0; i <= 3 * s; i++) g.set(Math.round(cx + i), Math.round(cx + s * 0.5 - i * 0.6), c.fill).set(Math.round(cx + i), Math.round(cx + s * 0.5 - i * 0.6) + 1, c.fill);
    g.rect(Math.round(cx - 2 * s), Math.round(cx - s), s, s, PAL.pink);
  },
  river: (g, n, s, c) => {
    if (s === 1) {
      stampEmblem(g, n, s, c, RIVER_SMALL);
      return;
    }
    const inset = 2 * s + 1;
    waveLine(g, inset, n - 1 - inset, Math.round(n * 0.38), s, c.emblem);
    waveLine(g, inset, n - 1 - inset, Math.round(n * 0.6), s, c.glow, 2 * s);
  },
  lake: (g, n, s, c) => {
    const cx = (n - 1) / 2;
    for (let r = 1; r <= 3; r++) {
      for (let a = 0; a < 64; a++) {
        const ang = (a / 64) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * r * 1.3 * s);
        const y = Math.round(cx + Math.sin(ang) * r * 0.6 * s);
        if ((r !== 2 || a % 8 < 5) && y !== Math.round(cx)) g.paintOver(x, y, r === 3 ? c.glow : c.emblem);
      }
    }
    g.set(Math.round(cx), Math.round(cx), c.emblem);
  },
  ocean: (g, n, s, c) => stampEmblem(g, n, s, c, OCEAN),
  tsunami: (g, n, s, c) => stampEmblem(g, n, s, c, TSUNAMI),
};

function badgeGrid(tier: TierId, size: BadgeSize): PixelGrid {
  const n = size === 'small' ? BADGE_SMALL : BADGE_LARGE;
  const s = size === 'small' ? 1 : 2;
  const c = TIER_COLORS[tier];
  const cx = (n - 1) / 2;
  const r = n / 2 - 1.5;
  const g = new PixelGrid(n, n);
  const fancy = tier === 'ocean' || tier === 'tsunami';
  g.ellipse(cx, cx, r, r, fancy ? c.glow : c.rim);
  g.ellipse(cx, cx, r - s, r - s, c.fill);
  EMBLEMS[tier](g, n, s, c);
  g.ellipse(cx - r / 2, cx - r / 2, s * 0.6, s * 0.6, PAL.white);
  return g.outlined(fancy ? c.rim : PAL.ink);
}

/** Cached rank tier badge: 'small' 12x12 for HUD / lists, 'large' 24x24 for results. */
export function getTierBadge(tier: TierId, size: BadgeSize = 'small'): HTMLCanvasElement {
  return cached(`badge:${tier}:${size}`, () => badgeGrid(tier, size).toCanvas());
}

// ---------------------------------------------------------------------------------------
// Emote bubbles
// ---------------------------------------------------------------------------------------

export const EMOTE_BUBBLE_W = 16;
export const EMOTE_BUBBLE_H = 15;

const EMOTE_GLYPHS: readonly { rows: readonly string[]; legend: Legend }[] = [
  {
    legend: { y: PAL.yellow, o: PAL.orange, k: PAL.ink, g: PAL.gold },
    rows: ['...yyy...', '..yyyyy..', '..yykyyoo', '...yyyooo', 'y..yyyy..', 'yyyyyyyy.', '.yyyyyyg.', '..ggggg..'],
  },
  {
    legend: { g: PAL.green, w: PAL.white, k: PAL.ink, p: PAL.pink, d: PAL.greenDark },
    rows: ['.gg...gg.', 'gwkg.gkwg', 'ggggggggg', 'gpgggggpg', 'gdgggggdg', '.gdddddg.', '..ggggg..'],
  },
  {
    legend: { a: PAL.greyLight, d: PAL.pink, k: PAL.ink, p: PAL.pink },
    rows: ['aa.....aa', 'ada...ada', '.aaaaaaa.', 'aakaaakaa', 'aaaapaaaa', '.aaaaaaa.', '..aaaaa..'],
  },
  {
    legend: { r: PAL.red, R: PAL.redDark, y: PAL.yellow, g: PAL.gold },
    rows: ['.......yy', '......yyy', '.rr..yyyy', 'rrrrryyyy', 'rRRRggggg', '.RR..gggg', '......ggg', '.......gg'],
  },
];

/** Cached pixel speech bubble for an emote (tail at the bottom-left, above the critter). */
export function getEmoteBubble(id: EmoteId): HTMLCanvasElement {
  return cached(`emote:${id}`, () => {
    const g = new PixelGrid(EMOTE_BUBBLE_W, EMOTE_BUBBLE_H);
    g.rect(2, 1, 12, 11, PAL.white).rect(1, 2, 14, 9, PAL.white);
    g.rect(3, 12, 2, 1, PAL.white).set(3, 13, PAL.white);
    g.hline(2, 13, 11, PAL.cloud);
    const art = EMOTE_GLYPHS[id];
    const glyph = PixelGrid.fromRows(art.rows, art.legend);
    g.blit(glyph, Math.floor((EMOTE_BUBBLE_W - glyph.w) / 2), 2 + Math.floor((9 - glyph.h) / 2));
    return g.outlined(PAL.ink).toCanvas();
  });
}

// ---------------------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------------------

/** Scale a text grid 2x and paint it with horizontal colour bands (top to bottom). */
function bandedTitle(text: string, bands: readonly string[]): PixelGrid {
  const base = textGrid(text, 'big', PAL.white);
  const big = base.resized(base.w * 2, base.h * 2);
  for (let y = 0; y < big.h; y++) {
    const color = bands[Math.min(bands.length - 1, Math.floor((y * bands.length) / big.h))];
    for (let x = 0; x < big.w; x++) big.paintOver(x, y, color);
  }
  return big;
}

/** Cached two-line "SPLASH / CRITTERS" logo with outline, drop shadow and drips. */
export function getLogo(): HTMLCanvasElement {
  return cached('logo', () => {
    const splash = bandedTitle('SPLASH', [PAL.foam, PAL.skyLight, PAL.sky, PAL.blue]);
    const critters = bandedTitle('CRITTERS', [PAL.yellowLight, PAL.yellow, PAL.yellow, PAL.orange]);
    const w = Math.max(splash.w, critters.w) + 6;
    const g = new PixelGrid(w, splash.h + critters.h + 9);
    const sx = Math.floor((w - splash.w) / 2);
    const cx = Math.floor((w - critters.w) / 2);
    const layout = new PixelGrid(w, g.h).blit(splash, sx, 2).blit(critters, cx, splash.h + 5);
    [3, 17, 30, 44].forEach((dx, i) => {
      const x = sx + dx;
      for (let y = 0; y < 2 + (i % 2); y++) layout.set(x, splash.h + 2 + y, PAL.sky);
    });
    const outlined = layout.outlined(PAL.ink, true);
    g.blit(outlined.silhouette(PAL.navy), 1, 1);
    g.blit(outlined, 0, 0);
    return g.toCanvas();
  });
}
