// Bitmap text rendering with the two embedded fonts ('big' 5x7, 'small' 3x5).
// Glyphs are rasterised once per (font, colour) into an atlas canvas and blitted with
// drawImage. Lowercase maps to uppercase; unknown characters render as '?'.
// '\n' starts a new line (each line is aligned independently).
import { BIG_GLYPHS, SMALL_GLYPHS } from './font-data';
import { PAL } from './palette';
import { PixelGrid, cached, ctx2d, makeCanvas, scaleCanvas } from './pixelart';

export type FontId = 'big' | 'small';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextOpts {
  font?: FontId;
  color?: string;
  align?: TextAlign;
  /** Drop-shadow colour drawn 1px down-right. */
  shadow?: string;
}

interface Glyph {
  w: number;
  /** Bit rows (bit x set = ink at column x). */
  rows: number[];
  /** Atlas x offset (set when the glyph table is built). */
  ax: number;
}

interface FontDef {
  id: FontId;
  height: number;
  /** Gap between glyphs. */
  spacing: number;
  spaceWidth: number;
  lineGap: number;
  glyphs: Map<string, Glyph>;
  atlasWidth: number;
}

function parseGlyphs(src: Record<string, string>): { glyphs: Map<string, Glyph>; atlasWidth: number } {
  const glyphs = new Map<string, Glyph>();
  let ax = 0;
  for (const [ch, def] of Object.entries(src)) {
    const lines = def.split('|');
    const w = lines[0].length;
    const rows = lines.map((line) => {
      let bits = 0;
      for (let x = 0; x < line.length; x++) if (line[x] === '#') bits |= 1 << x;
      return bits;
    });
    glyphs.set(ch, { w, rows, ax });
    ax += w + 1;
  }
  return { glyphs, atlasWidth: ax };
}

function buildFont(id: FontId, src: Record<string, string>, height: number, spaceWidth: number, lineGap: number): FontDef {
  const { glyphs, atlasWidth } = parseGlyphs(src);
  return { id, height, spacing: 1, spaceWidth, lineGap, glyphs, atlasWidth };
}

const FONTS: Record<FontId, FontDef> = {
  big: buildFont('big', BIG_GLYPHS, 7, 3, 3),
  small: buildFont('small', SMALL_GLYPHS, 5, 2, 2),
};

/** Distance between the tops of two consecutive lines. */
export function lineHeight(font: FontId = 'big'): number {
  const f = FONTS[font];
  return f.height + f.lineGap;
}

function glyphFor(f: FontDef, ch: string): Glyph | null {
  if (ch === ' ') return null;
  return f.glyphs.get(ch.toUpperCase()) ?? f.glyphs.get('?') ?? null;
}

function lineWidth(f: FontDef, line: string): number {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const g = glyphFor(f, line[i]);
    w += g ? g.w : f.spaceWidth;
    if (i < line.length - 1) w += f.spacing;
  }
  return w;
}

/** Width in pixels of the widest line of `text`. */
export function measureText(text: string, font: FontId = 'big'): number {
  const f = FONTS[font];
  return text.split('\n').reduce((m, line) => Math.max(m, lineWidth(f, line)), 0);
}

/** Height in pixels of `text` (all lines). */
export function measureTextHeight(text: string, font: FontId = 'big'): number {
  const f = FONTS[font];
  const lines = text.split('\n').length;
  return lines * f.height + (lines - 1) * f.lineGap;
}

function atlas(f: FontDef, color: string): HTMLCanvasElement {
  return cached(`font:${f.id}:${color}`, () => {
    const cv = makeCanvas(f.atlasWidth, f.height);
    const ctx = ctx2d(cv);
    ctx.fillStyle = color;
    for (const g of f.glyphs.values()) {
      g.rows.forEach((bits, y) => {
        for (let x = 0; x < g.w; x++) if (bits & (1 << x)) ctx.fillRect(g.ax + x, y, 1, 1);
      });
    }
    return cv;
  });
}

function drawLine(ctx: CanvasRenderingContext2D, f: FontDef, sheet: HTMLCanvasElement, line: string, x: number, y: number): void {
  let cx = x;
  for (const ch of line) {
    const g = glyphFor(f, ch);
    if (g) {
      ctx.drawImage(sheet, g.ax, 0, g.w, f.height, cx, y, g.w, f.height);
      cx += g.w + f.spacing;
    } else {
      cx += f.spaceWidth + f.spacing;
    }
  }
}

/**
 * Draw pixel text with its top-left (or top-centre / top-right, per `align`) at (x, y).
 * Coordinates are rounded to whole pixels. Returns the drawn width.
 */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: TextOpts = {}): number {
  const f = FONTS[opts.font ?? 'big'];
  const sheet = atlas(f, opts.color ?? PAL.white);
  const shadowSheet = opts.shadow ? atlas(f, opts.shadow) : null;
  const lines = text.split('\n');
  let maxW = 0;
  lines.forEach((line, i) => {
    const w = lineWidth(f, line);
    maxW = Math.max(maxW, w);
    const align = opts.align ?? 'left';
    const lx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
    const ly = Math.round(y + i * lineHeight(f.id));
    if (shadowSheet) drawLine(ctx, f, shadowSheet, line, lx + 1, ly + 1);
    drawLine(ctx, f, sheet, line, lx, ly);
  });
  return maxW;
}

export interface TextCanvasOpts {
  font?: FontId;
  color?: string;
  /** Integer upscale factor (default 1). */
  scale?: number;
  shadow?: string;
  align?: TextAlign;
}

/**
 * Render text into its own canvas for DOM use (buttons, headings). The canvas is scaled by
 * `scale` and styled `image-rendering: pixelated` so it stays crisp.
 */
export function textToCanvas(text: string, opts: TextCanvasOpts = {}): HTMLCanvasElement {
  const font = opts.font ?? 'big';
  const pad = opts.shadow ? 1 : 0;
  const w = measureText(text, font) + pad;
  const h = measureTextHeight(text, font) + pad;
  const base = makeCanvas(w, h);
  const align = opts.align ?? 'left';
  const x = align === 'center' ? (w - pad) / 2 : align === 'right' ? w - pad : 0;
  drawText(ctx2d(base), text, x, 0, { font, color: opts.color, shadow: opts.shadow, align });
  const out = scaleCanvas(base, opts.scale ?? 1);
  out.style.imageRendering = 'pixelated';
  return out;
}

/** Single-line text as a pixel grid (used to build logos and outlined titles). */
export function textGrid(text: string, font: FontId, color: string): PixelGrid {
  const f = FONTS[font];
  const g = new PixelGrid(Math.max(1, lineWidth(f, text)), f.height);
  let cx = 0;
  for (const ch of text) {
    const glyph = glyphFor(f, ch);
    if (!glyph) {
      cx += f.spaceWidth + f.spacing;
      continue;
    }
    glyph.rows.forEach((bits, y) => {
      for (let x = 0; x < glyph.w; x++) if (bits & (1 << x)) g.set(cx + x, y, color);
    });
    cx += glyph.w + f.spacing;
  }
  return g;
}

/** Every character the fonts can draw (dev contact sheet, input filtering). */
export function fontCharset(font: FontId = 'big'): string {
  return [...FONTS[font].glyphs.keys()].join('');
}
