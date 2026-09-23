// Shared pixel-art helpers. All procedural art is composed in PixelGrid space (a small
// matrix of CSS colour strings, null = transparent) and only rasterised to a canvas once,
// through the keyed sprite cache. Browser only (document.createElement('canvas')).

export type Px = string | null;

/** Legend for string-grid art: one character -> colour (null = transparent). */
export type Legend = Record<string, Px>;

export class PixelGrid {
  readonly w: number;
  readonly h: number;
  readonly px: Px[];

  constructor(w: number, h: number, fill: Px = null) {
    this.w = w;
    this.h = h;
    this.px = new Array<Px>(w * h).fill(fill);
  }

  /** Build from rows of characters; unknown characters and '.' are transparent. */
  static fromRows(rows: readonly string[], legend: Legend): PixelGrid {
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const g = new PixelGrid(w, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = legend[row[x]];
        if (c) g.set(x, y, c);
      }
    });
    return g;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Px {
    return this.inside(x, y) ? this.px[y * this.w + x] : null;
  }

  set(x: number, y: number, c: Px): this {
    if (this.inside(x, y)) this.px[y * this.w + x] = c;
    return this;
  }

  /** Set only where the pixel is currently opaque. */
  paintOver(x: number, y: number, c: string): this {
    if (this.get(x, y)) this.set(x, y, c);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Px): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    return this;
  }

  hline(x0: number, x1: number, y: number, c: Px): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
    return this;
  }

  vline(x: number, y0: number, y1: number, c: Px): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
    return this;
  }

  /**
   * Filled ellipse centred on pixel coordinate (cx, cy); use .5 centres (e.g. 7.5) for
   * even-width shapes that straddle two pixels.
   */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Px): this {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Copy opaque pixels of src onto this grid at (dx, dy). */
  blit(src: PixelGrid, dx: number, dy: number): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.px[y * src.w + x];
        if (c) this.set(dx + x, dy + y, c);
      }
    }
    return this;
  }

  clone(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) g.px[i] = this.px[i];
    return g;
  }

  crop(x: number, y: number, w: number, h: number): PixelGrid {
    const g = new PixelGrid(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) g.set(xx, yy, this.get(x + xx, y + yy));
    return g;
  }

  flipX(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.set(this.w - 1 - x, y, this.get(x, y));
    return g;
  }

  /** Rotate 90 degrees clockwise `turns` times. */
  rotate(turns: number): PixelGrid {
    let g: PixelGrid = this.clone();
    for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
      const r = new PixelGrid(g.h, g.w);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) r.set(g.h - 1 - y, x, g.get(x, y));
      g = r;
    }
    return g;
  }

  /** Copy with every opaque pixel painted `color` (drop shadows). */
  silhouette(color: string): PixelGrid {
    const g = this.clone();
    for (let i = 0; i < g.px.length; i++) if (g.px[i]) g.px[i] = color;
    return g;
  }

  /** Return a copy with a 1px outline added on transparent pixels touching opaque ones. */
  outlined(color: string, diagonal = false): PixelGrid {
    const g = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        const touches =
          this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1) ||
          (diagonal && (this.get(x - 1, y - 1) || this.get(x + 1, y - 1) || this.get(x - 1, y + 1) || this.get(x + 1, y + 1)));
        if (touches) g.set(x, y, color);
      }
    }
    return g;
  }

  /** Resample into a new size with nearest-neighbour (used for squash/stretch frames). */
  resized(w: number, h: number): PixelGrid {
    const g = new PixelGrid(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        g.set(x, y, this.get(Math.floor(((x + 0.5) * this.w) / w), Math.floor(((y + 0.5) * this.h) / h)));
      }
    }
    return g;
  }

  /** Bounding box of opaque pixels, or null when fully transparent. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.get(x, y)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  toCanvas(): HTMLCanvasElement {
    const cv = makeCanvas(this.w, this.h);
    const ctx = ctx2d(cv);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  return cv;
}

export function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/** Return the canvas cached under `key`, building (and caching) it on first use. */
export function cached(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  let cv = spriteCache.get(key);
  if (!cv) {
    cv = build();
    spriteCache.set(key, cv);
  }
  return cv;
}

/** Number of canvases currently cached (dev QA statistic). */
export function cachedSpriteCount(): number {
  return spriteCache.size;
}

/** Deterministic 32-bit hash of small integers (tile variants, sparkle placement). */
export function hashInts(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** Scale a canvas by an integer factor with crisp (nearest-neighbour) pixels. */
export function scaleCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const s = Math.max(1, Math.floor(scale));
  if (s === 1) return src;
  const cv = makeCanvas(src.width * s, src.height * s);
  const ctx = ctx2d(cv);
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
