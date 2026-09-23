// Icons: chunky 16x16 power-up pickups with a sweeping shine, HUD glyphs (stats, ping bars,
// winner crown, soaked droplet, menu cursor, ...). Tier badges, emote bubbles and the logo
// live in sprites-badges.ts and are re-exported here so UI code has one icon import.
import { PowerUp, type PowerUpKind } from '@splash/shared';
import { PAL } from './palette';
import { PixelGrid, cached, type Legend } from './pixelart';

// ---------------------------------------------------------------------------------------
// Power-up items
// ---------------------------------------------------------------------------------------

export const ITEM_SIZE = 16;
/** Shine sweep frames (the renderer also bobs the item 1px). */
export const ITEM_FRAMES = 4;
export const ITEM_FRAME_MS = 160;

interface ItemArt {
  rim: string;
  rimLight: string;
  rows: readonly string[];
  legend: Legend;
}

const ITEMS: Record<Exclude<PowerUpKind, 0>, ItemArt> = {
  [PowerUp.Balloon]: {
    rim: PAL.red,
    rimLight: PAL.pinkLight,
    legend: { r: PAL.red, R: PAL.redDark, w: PAL.pinkLight, y: PAL.yellow },
    rows: ['.rrrr.....', 'rwwrrr....', 'rwrrrrr...', 'rrrrrrR.y.', 'rrrrrRRyyy', '.rrRRR..y.', '..RRR.....', '...R......', '..R.......'],
  },
  [PowerUp.Range]: {
    rim: PAL.sky,
    rimLight: PAL.foam,
    legend: { b: PAL.sky, B: PAL.blue, w: PAL.foam, l: PAL.skyLight },
    rows: ['l...b...l.', '....b.....', '...bbb....', '..bwbbb...', 'l.bwbbb.l.', '.bbbbbbB..', '.bbbbbBB..', '..bbBBB...', 'l..BB...l.'],
  },
  [PowerUp.Speed]: {
    rim: PAL.green,
    rimLight: PAL.lime,
    legend: { g: PAL.green, G: PAL.lime, d: PAL.greenDark },
    rows: ['.gggggggg.', 'gGgGgGgGgg', 'gGgGgGgGg.', '.gGgGgGg..', '..gGgGg...', '..ggggg...', '...ddd....', '...ddd....', '...ddd....'],
  },
  [PowerUp.Boots]: {
    rim: PAL.yellow,
    rimLight: PAL.yellowLight,
    legend: { y: PAL.yellow, l: PAL.yellowLight, r: PAL.red, d: PAL.gold },
    rows: ['.rrrr.....', '.yyyy.....', '.ylyy.....', '.ylyy.....', '.yyyy.....', '.yyyyyyy..', 'yyyyyyyyy.', 'ddddddddd.'],
  },
};

const SHINE_DIAGONAL = [5, 13, 21, 99] as const;

function itemGrid(kind: Exclude<PowerUpKind, 0>, frame: number): PixelGrid {
  const art = ITEMS[kind];
  const g = new PixelGrid(ITEM_SIZE, ITEM_SIZE);
  g.rect(2, 1, 12, 14, art.rim).rect(1, 2, 14, 12, art.rim);
  g.rect(2, 2, 12, 12, PAL.navy);
  g.hline(2, 13, 1, art.rimLight).vline(1, 2, 13, art.rimLight);
  const d = SHINE_DIAGONAL[frame];
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if (Math.abs(x + y - d) <= 1) g.set(x, y, PAL.slate);
  const icon = PixelGrid.fromRows(art.rows, art.legend);
  const padded = new PixelGrid(icon.w + 2, icon.h + 2).blit(icon, 1, 1).outlined(PAL.ink);
  g.blit(padded, Math.floor((ITEM_SIZE - padded.w + 1) / 2), Math.floor((ITEM_SIZE - padded.h + 1) / 2));
  return g.outlined(PAL.ink);
}

/** Cached 16x16 power-up icon for an exposed item, ITEM_FRAMES shine frames. */
export function getItem(kind: PowerUpKind, frame: number): HTMLCanvasElement | null {
  if (kind === PowerUp.None) return null;
  const f = ((frame % ITEM_FRAMES) + ITEM_FRAMES) % ITEM_FRAMES;
  return cached(`item:${kind}:${f}`, () => itemGrid(kind, f).toCanvas());
}

// ---------------------------------------------------------------------------------------
// HUD glyphs
// ---------------------------------------------------------------------------------------

export type GlyphName =
  | 'balloon'
  | 'range'
  | 'speed'
  | 'boots'
  | 'ping1'
  | 'ping2'
  | 'ping3'
  | 'ping4'
  | 'crown'
  | 'soaked'
  | 'cursor'
  | 'lock'
  | 'bot'
  | 'clock'
  | 'wave'
  | 'star';

interface GlyphArt {
  rows: readonly string[];
  legend: Legend;
}

const PING_LEGEND: Legend = { g: PAL.green, y: PAL.yellow, r: PAL.red, o: PAL.greyDark };

function pingRows(level: number): string[] {
  const lit = level >= 3 ? 'g' : level === 2 ? 'y' : 'r';
  const rows: string[] = [];
  for (let y = 0; y < 8; y++) {
    let row = '';
    for (let bar = 0; bar < 4; bar++) {
      const height = (bar + 1) * 2;
      const on = y >= 8 - height;
      row += (on ? (bar < level ? lit : 'o') : '.') + (bar < 3 ? '.' : '');
    }
    rows.push(row);
  }
  return rows;
}

const GLYPHS: Record<GlyphName, GlyphArt> = {
  balloon: {
    legend: { r: PAL.red, R: PAL.redDark, w: PAL.pinkLight },
    rows: ['.rrrr.', 'rwrrrr', 'rwrrrr', 'rrrrRR', '.rRRR.', '..RR..', '...R..', '..R...'],
  },
  range: {
    legend: { b: PAL.sky, w: PAL.foam },
    rows: ['...b...', '...b...', '..bwb..', 'bbwwwbb', '..bwb..', '...b...', '...b...'],
  },
  speed: {
    legend: { g: PAL.green, G: PAL.lime, d: PAL.greenDark },
    rows: ['ggggggg', 'gGgGgGg', '.gGgGg.', '..ggg..', '..ddd..', '..ddd..'],
  },
  boots: {
    legend: { y: PAL.yellow, r: PAL.red, d: PAL.gold },
    rows: ['.rrr..', '.yyy..', '.yyy..', '.yyy..', '.yyyyy', 'yyyyyy', 'dddddd'],
  },
  ping1: { legend: PING_LEGEND, rows: pingRows(1) },
  ping2: { legend: PING_LEGEND, rows: pingRows(2) },
  ping3: { legend: PING_LEGEND, rows: pingRows(3) },
  ping4: { legend: PING_LEGEND, rows: pingRows(4) },
  crown: {
    legend: { y: PAL.yellow, g: PAL.gold, r: PAL.red, w: PAL.white },
    rows: ['y..y..y', 'yy.y.yy', 'ywyyyyy', 'yyyryyy', 'ggggggg'],
  },
  soaked: {
    legend: { b: PAL.sky, B: PAL.blue, w: PAL.foam },
    rows: ['..b...', '..b...', '.bbb..', '.wbbb.', 'bwbbbB', 'bbbbBB', '.bBBB.'],
  },
  cursor: {
    legend: { w: PAL.white, c: PAL.cloud },
    rows: ['w....', 'ww...', 'www..', 'wwww.', 'wwwww', 'wwwc.', 'wwc..', 'wc...', 'c....'],
  },
  lock: {
    legend: { g: PAL.greyLight, y: PAL.yellow, d: PAL.gold, k: PAL.ink },
    rows: ['.ggg.', 'g...g', 'g...g', 'yyyyy', 'yykyy', 'yykyy', 'ddddd'],
  },
  bot: {
    legend: { g: PAL.greyLight, G: PAL.grey, r: PAL.red, s: PAL.sky },
    rows: ['...r...', '...G...', '.ggggg.', 'gsgggsg', 'ggggggg', '.gGGGg.', '.ggggg.'],
  },
  clock: {
    legend: { w: PAL.white, g: PAL.greyLight, k: PAL.ink, r: PAL.red },
    rows: ['..rr..', '.wwww.', 'wwkwww', 'wwkwww', 'wwwkkw', 'wwwwww', '.gggg.'],
  },
  wave: {
    legend: { b: PAL.blue, s: PAL.sky, w: PAL.foam },
    rows: ['..ww...', '.wsss..', 'ws..s..', 'w...ss.', '...ssss', 'bbbbbbb', 'bbbbbbb'],
  },
  star: {
    legend: { y: PAL.yellow, g: PAL.gold, w: PAL.white },
    rows: ['...y...', '...y...', '.yywyy.', 'yyywyyy', '.yyyyy.', '.yg.gy.', 'yg...gy'],
  },
};

/** Every glyph name (dev contact sheet). */
export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

/** Cached HUD glyph (<= 9x10 including its 1px ink outline). */
export function getGlyph(name: GlyphName): HTMLCanvasElement {
  return cached(`glyph:${name}`, () => {
    const art = GLYPHS[name];
    const fill = PixelGrid.fromRows(art.rows, art.legend);
    return new PixelGrid(fill.w + 2, fill.h + 2).blit(fill, 1, 1).outlined(PAL.ink).toCanvas();
  });
}

/** Ping glyph for a round-trip time in ms (4 bars good ... 1 bar bad). */
export function pingGlyph(rttMs: number): HTMLCanvasElement {
  const name: GlyphName = rttMs < 80 ? 'ping4' : rttMs < 150 ? 'ping3' : rttMs < 250 ? 'ping2' : 'ping1';
  return getGlyph(name);
}

export { BADGE_LARGE, BADGE_SMALL, EMOTE_BUBBLE_H, EMOTE_BUBBLE_W, getEmoteBubble, getLogo, getTierBadge } from './sprites-badges';
export type { BadgeSize } from './sprites-badges';
