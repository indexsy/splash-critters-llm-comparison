// Fitting pixel text into a width: names clipped with a '.' mark, and result-card headlines
// that fall back to two lines (the winner's name, then the rest) when one line is too wide.
// Pure: widths come from the font metrics, so layouts are testable without a canvas.
import { clip, headlineText, type ResultHeadline } from '../game/labels';
import { measureText, measureTextHeight, type FontId } from './font';

/** Width of a 1x label: glyphs (doubled when bold) plus labelCanvas's 1 px outline each side. */
export function labelWidth(text: string, opts: { font?: FontId; bold?: boolean } = {}): number {
  return measureText(text, opts.font ?? 'big') * (opts.bold ? 2 : 1) + 2;
}

/** Height of a one-line 1x label (glyph height plus the outline). */
export function labelHeight(opts: { font?: FontId; bold?: boolean } = {}): number {
  return measureTextHeight('A', opts.font ?? 'big') * (opts.bold ? 2 : 1) + 2;
}

/** `text` clipped (marked with '.') until its plain width fits `maxW` pixels in `font`. */
export function fitText(text: string, maxW: number, font: FontId): string {
  let n = text.length;
  let out = text;
  while (n > 1 && measureText(out, font) > maxW) out = clip(text, --n);
  return out;
}

/** A 1x outlined label clipped until it fits `maxW` pixels. */
export function fitLabel(text: string, maxW: number, font: FontId = 'big'): string {
  return fitText(text, maxW - 2, font);
}

/**
 * Result-card headline within `maxW` pixels: one line when it fits, otherwise the winner's
 * name (clipped to fit) on its own line above the rest.
 */
export function headlineLines(h: ResultHeadline, maxW: number): string[] {
  const one = headlineText(h);
  if (!h.name || labelWidth(one) <= maxW) return [fitLabel(one, maxW)];
  return [fitLabel(h.name, maxW), fitLabel(h.rest, maxW)];
}
