// Outlined (and optionally upscaled) single-line pixel text for in-game callouts: countdown
// numbers, announcer pops, card titles. Built once per (text, style) through the sprite cache.
import type { FontId } from './font';
import { textGrid } from './font';
import { PAL } from './palette';
import { PixelGrid, cached, scaleCanvas } from './pixelart';

export interface LabelStyle {
  font?: FontId;
  color?: string;
  /** Outline colour (1 px, including diagonals); null for none. */
  outline?: string | null;
  /** Integer upscale applied after outlining (chunky 8-bit look). */
  scale?: number;
  /** Colour bands painted top to bottom over the glyphs (overrides `color`). */
  bands?: readonly string[];
  /**
   * Double the glyphs before outlining, so strokes are twice as thick as the outline (big
   * callouts stay readable instead of turning into outline blobs). Doubles the final size.
   */
  bold?: boolean;
}

function bandPaint(g: PixelGrid, bands: readonly string[]): void {
  for (let y = 0; y < g.h; y++) {
    const c = bands[Math.min(bands.length - 1, Math.floor((y * bands.length) / g.h))];
    for (let x = 0; x < g.w; x++) g.paintOver(x, y, c);
  }
}

/** Cached canvas for one line of outlined pixel text. */
export function labelCanvas(text: string, style: LabelStyle = {}): HTMLCanvasElement {
  const font = style.font ?? 'big';
  const color = style.color ?? PAL.white;
  const outline = style.outline === undefined ? PAL.ink : style.outline;
  const scale = Math.max(1, Math.floor(style.scale ?? 1));
  const bands = style.bands ?? null;
  const bold = style.bold === true;
  const key = `label:${font}:${color}:${outline}:${scale}:${bands ? bands.join('/') : ''}:${bold ? 1 : 0}:${text}`;
  return cached(key, () => {
    const base = textGrid(text, font, color);
    const glyphs = bold ? base.resized(base.w * 2, base.h * 2) : base;
    if (bands) bandPaint(glyphs, bands);
    const pad = outline ? 1 : 0;
    const g = new PixelGrid(glyphs.w + pad * 2, glyphs.h + pad * 2).blit(glyphs, pad, pad);
    return scaleCanvas((outline ? g.outlined(outline, true) : g).toCanvas(), scale);
  });
}

/** Draw a label with its top edge at `y`, horizontally aligned on `x`. Returns its size. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: LabelStyle & { align?: 'left' | 'center' | 'right' } = {},
): { w: number; h: number } {
  const cv = labelCanvas(text, style);
  const align = style.align ?? 'center';
  const left = align === 'center' ? x - cv.width / 2 : align === 'right' ? x - cv.width : x;
  ctx.drawImage(cv, Math.round(left), Math.round(y));
  return { w: cv.width, h: cv.height };
}
