// Big crisp DOM headings drawn with the embedded 5x7 bitmap font (render/font.ts). The text is
// rasterised once at 1x onto a tiny canvas (outline + drop shadow + fill); CSS then scales it by
// `scale * --px` with nearest-neighbour sampling, so it stays sharp at every window size.
import { drawText, measureText, measureTextHeight } from '../render/font';
import { PAL } from '../render/palette';
import { ctx2d, makeCanvas } from '../render/pixelart';

export interface PixelTitleOptions {
  /** Glyph fill colour. */
  color?: string;
  /** One-font-pixel outline around the glyphs; null disables it. */
  outline?: string | null;
  /** Drop shadow one font pixel below; null disables it. */
  shadow?: string | null;
}

const RING: readonly [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * Render `text` ('\n' for more lines, each centred) as a pixel heading. `scale` is how many
 * backbuffer pixels one font pixel covers (2 => 10x14 glyphs). Sized via --w/--h in styles.css.
 */
export function pixelTitle(text: string, scale = 2, opts: PixelTitleOptions = {}): HTMLCanvasElement {
  const color = opts.color ?? PAL.sand;
  const outline = opts.outline === undefined ? PAL.ink : opts.outline;
  const shadow = opts.shadow === undefined ? PAL.teal : opts.shadow;
  const pad = outline ? 1 : 0;
  const drop = shadow ? 1 : 0;
  const textW = measureText(text, 'big');
  const width = textW + pad * 2;
  const height = measureTextHeight(text, 'big') + pad * 2 + drop;

  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  const cx = pad + textW / 2;
  const paint = (fill: string, dx: number, dy: number) =>
    drawText(ctx, text, cx + dx, pad + dy, { font: 'big', color: fill, align: 'center' });
  // Back to front: shadow outline, shadow, glyph outline, glyph.
  for (const dy of drop ? [drop, 0] : [0]) {
    if (outline) for (const [ox, oy] of RING) paint(outline, ox, dy + oy);
    paint(dy > 0 && shadow ? shadow : color, 0, dy);
  }

  const s = Math.max(1, Math.floor(scale));
  canvas.className = 'pixel-title';
  canvas.style.setProperty('--w', String(width * s));
  canvas.style.setProperty('--h', String(height * s));
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', text.replace(/\n/g, ' '));
  return canvas;
}
