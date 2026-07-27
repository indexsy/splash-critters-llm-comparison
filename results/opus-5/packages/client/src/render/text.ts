/**
 * 5x7 bitmap font. Every glyph is seven rows of five bits, most significant bit
 * on the left, so text is drawn as hard pixels with no antialiasing anywhere.
 * Rendered strings are cached as offscreen canvases because a HUD redraws the
 * same handful of labels every frame.
 */

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
export const GLYPH_ADVANCE = 6;

const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '"': [10, 10, 0, 0, 0, 0, 0],
  '#': [10, 10, 31, 10, 31, 10, 10],
  '%': [17, 1, 2, 4, 8, 16, 17],
  '&': [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 0, 0, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '*': [0, 10, 4, 31, 4, 10, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  ',': [0, 0, 0, 0, 0, 4, 8],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0, 4],
  '/': [1, 1, 2, 4, 8, 16, 16],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ':': [0, 4, 4, 0, 4, 4, 0],
  ';': [0, 4, 4, 0, 4, 4, 8],
  '<': [2, 4, 8, 16, 8, 4, 2],
  '=': [0, 0, 31, 0, 31, 0, 0],
  '>': [8, 4, 2, 1, 2, 4, 8],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '@': [14, 17, 19, 21, 23, 16, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 25, 21, 19, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '[': [14, 8, 8, 8, 8, 8, 14],
  ']': [14, 2, 2, 2, 2, 2, 14],
  '^': [4, 10, 17, 0, 0, 0, 0],
  _: [0, 0, 0, 0, 0, 0, 31],
  '|': [4, 4, 4, 4, 4, 4, 4],
};

const FALLBACK = FONT['?'];

export type TextAlign = 'left' | 'center' | 'right';

export interface TextOptions {
  scale?: number;
  align?: TextAlign;
  /** Draws a one-pixel drop shadow, which is what keeps text legible on tiles. */
  shadow?: string | null;
}

export function textWidth(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return (text.length * GLYPH_ADVANCE - 1) * scale;
}

export function textHeight(scale = 1): number {
  return GLYPH_HEIGHT * scale;
}

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 512;

function renderToCanvas(text: string, color: string, scale: number): HTMLCanvasElement {
  const width = Math.max(1, textWidth(text, scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = GLYPH_HEIGHT * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = color;

  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]] ?? FALLBACK;
    const originX = i * GLYPH_ADVANCE * scale;
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      const bits = glyph[row];
      if (bits === 0) continue;
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if ((bits & (1 << (GLYPH_WIDTH - 1 - col))) === 0) continue;
        ctx.fillRect(originX + col * scale, row * scale, scale, scale);
      }
    }
  }
  return canvas;
}

function glyphCanvas(text: string, color: string, scale: number): HTMLCanvasElement {
  const key = `${scale}|${color}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = renderToCanvas(text, color, scale);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Draws `text` with its top-left (or top-centre / top-right) at (x, y). */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  opts: TextOptions = {},
): number {
  const scale = opts.scale ?? 1;
  const upper = text.toUpperCase();
  const width = textWidth(upper, scale);
  let originX = Math.round(x);
  if (opts.align === 'center') originX = Math.round(x - width / 2);
  else if (opts.align === 'right') originX = Math.round(x - width);
  const originY = Math.round(y);

  if (opts.shadow) {
    ctx.drawImage(glyphCanvas(upper, opts.shadow, scale), originX + scale, originY + scale);
  }
  ctx.drawImage(glyphCanvas(upper, color, scale), originX, originY);
  return width;
}

/** Trims to `maxChars` with a trailing dot so long nicknames cannot overflow. */
export function ellipsize(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}.`;
}
