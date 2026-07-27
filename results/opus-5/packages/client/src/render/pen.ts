/**
 * The pixel pen.
 *
 * Sprite code is far easier to read (and to tweak) when it is written in a small
 * local grid - 16x16 for a critter, 8x8 for a portrait - so the pen owns the one
 * job of mapping that grid onto the stage. Both edges of every rectangle are
 * rounded independently rather than rounding the origin and the size, because
 * that is what stops one-pixel seams appearing between neighbouring rectangles
 * once a squash is in play.
 *
 * Mirroring exists so left-facing art is simply the right-facing art flipped,
 * which is exactly the trick the era's cartridges used to halve their sprite ROM.
 */

export class Pen {
  private flipped = false;
  private scaleX = 1;
  private scaleY = 1;
  private anchor: number;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly originX: number,
    private readonly originY: number,
    private readonly size: number = 16,
  ) {
    this.anchor = size - 1;
  }

  /** Flip horizontally around the sprite's centre column. */
  mirror(on: boolean): this {
    this.flipped = on;
    return this;
  }

  /**
   * Deform around the centre column and the `anchor` row. The soak animation
   * flattens a critter onto its feet with squash(1.4, 0.3, 15).
   */
  squash(scaleX: number, scaleY: number, anchor: number): this {
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.anchor = anchor;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return;
    const localX = this.flipped ? this.size - x - w : x;
    const half = this.size / 2;
    const left = Math.round(this.originX + half + (localX - half) * this.scaleX);
    const right = Math.round(this.originX + half + (localX + w - half) * this.scaleX);
    const top = Math.round(this.originY + this.anchor + (y - this.anchor) * this.scaleY);
    const bottom = Math.round(this.originY + this.anchor + (y + h - this.anchor) * this.scaleY);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  }

  dot(x: number, y: number, color: string): void {
    this.rect(x, y, 1, 1, color);
  }

  /** Draws a bitmap row list, most significant bit on the left. */
  bits(x: number, y: number, rows: number[], width: number, color: string): void {
    for (let row = 0; row < rows.length; row++) {
      const value = rows[row];
      if (value === 0) continue;
      for (let col = 0; col < width; col++) {
        if ((value & (1 << (width - 1 - col))) === 0) continue;
        this.rect(x + col, y + row, 1, 1, color);
      }
    }
  }
}

/**
 * A filled rectangle with its four corner pixels cut away and a one-pixel
 * outline. Every body, head and hat in the game is built from these, which is
 * what gives the whole cast a single consistent chunky silhouette.
 */
export function blob(
  pen: Pen,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline: string,
): void {
  if (w < 3 || h < 3) {
    pen.rect(x, y, w, h, fill);
    return;
  }
  pen.rect(x + 1, y, w - 2, 1, outline);
  pen.rect(x + 1, y + h - 1, w - 2, 1, outline);
  pen.rect(x, y + 1, 1, h - 2, outline);
  pen.rect(x + w - 1, y + 1, 1, h - 2, outline);
  pen.rect(x + 1, y + 1, w - 2, h - 2, fill);
}

/** Crisp filled ellipse, scanline by scanline, centred on whole pixels. */
export function fillDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void {
  const centreX = Math.round(cx);
  const centreY = Math.round(cy);
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / (ry * ry);
    if (t <= 0) continue;
    const half = Math.max(1, Math.round(rx * Math.sqrt(t)));
    ctx.fillRect(centreX - half, centreY + dy, half * 2, 1);
  }
}
