// Animated title scene on the frame canvas: dithered dusk sky with drifting clouds, a rolling
// sea, a sandy beach where critters stroll and lob balloons, and the big logo shimmering like
// water (per-column wave + a travelling highlight).
import { frame } from '../../frame';
import { PAL } from '../../render/palette';
import { ctx2d, hashInts, makeCanvas, scaleCanvas } from '../../render/pixelart';
import { getLogo } from '../../render/sprites';
import { TILE, WATER_FRAMES, WATER_FRAME_MS, drawWater } from '../../render/tiles';
import { settings } from '../../settings';
import type { Scope } from './scope';
import { TitleActors } from './titleActors';

const FRAME_MS = 1000 / 30;
const SEA_TOP = 144;
const SEA_ROWS = 2;
const SAND_TOP = SEA_TOP + SEA_ROWS * TILE;
const LOGO_SCALE = 2;
const LOGO_Y = 12;
const SHIMMER_PERIOD_MS = 2600;

const SKY_BANDS: readonly [number, string][] = [
  [0, PAL.navy],
  [40, PAL.blueDark],
  [88, PAL.blue],
  [124, PAL.sky],
];

function paintSky(): HTMLCanvasElement {
  const cv = makeCanvas(frame.W, SEA_TOP);
  const ctx = ctx2d(cv);
  SKY_BANDS.forEach(([y, color], i) => {
    const end = SKY_BANDS[i + 1]?.[0] ?? SEA_TOP;
    ctx.fillStyle = color;
    ctx.fillRect(0, y, frame.W, end - y);
    if (i === 0) return;
    ctx.fillStyle = SKY_BANDS[i - 1][1];
    for (let row = 0; row < 4; row++) {
      for (let x = (row % 2) * 2; x < frame.W; x += 4 - (row >> 1)) ctx.fillRect(x, y + row, 1, 1);
    }
  });
  ctx.fillStyle = PAL.white;
  for (let i = 0; i < 26; i++) {
    const h = hashInts(i, 5);
    ctx.fillRect(h % frame.W, (h >>> 9) % 60, 1, 1);
  }
  return cv;
}

function paintSand(): HTMLCanvasElement {
  const cv = makeCanvas(frame.W, frame.H - SAND_TOP);
  const ctx = ctx2d(cv);
  ctx.fillStyle = PAL.sand;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = PAL.sandDark;
  ctx.fillRect(0, 0, cv.width, 2);
  for (let i = 0; i < 90; i++) {
    const h = hashInts(i, 23);
    ctx.fillStyle = i % 7 === 0 ? PAL.cream : PAL.sandDark;
    ctx.fillRect(h % cv.width, 3 + ((h >>> 8) % (cv.height - 3)), 1 + (i % 3 === 0 ? 1 : 0), 1);
  }
  return cv;
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = PAL.cloud;
  ctx.fillRect(x, y + 3, w, 4);
  ctx.fillRect(x + 3, y + 1, w - 8, 3);
  ctx.fillRect(x + 6, y, w - 16, 2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 4, y + 1, w - 12, 2);
  ctx.fillStyle = PAL.skyLight;
  ctx.fillRect(x + 1, y + 6, w - 2, 1);
}

function drawSea(ctx: CanvasRenderingContext2D, t: number): void {
  const waterFrame = Math.floor(t / WATER_FRAME_MS) % WATER_FRAMES;
  const scroll = Math.floor(t / 110) % TILE;
  for (let row = 0; row < SEA_ROWS; row++) {
    const dx = row % 2 ? scroll : -scroll;
    for (let x = -TILE; x < frame.W + TILE; x += TILE) drawWater(ctx, x + dx, SEA_TOP + row * TILE, waterFrame);
  }
  ctx.fillStyle = PAL.foam;
  for (let x = 0; x < frame.W; x += 3) {
    const lap = Math.round(Math.sin(t / 500 + x / 11) * 1.5 + 1.5);
    ctx.fillRect(x, SAND_TOP - 1 + lap, 3, 1);
  }
}

/** The logo's letter fills only (outline and drop-shadow pixels cleared): where light may play. */
function fillMask(src: HTMLCanvasElement): HTMLCanvasElement {
  const cv = makeCanvas(src.width, src.height);
  const ctx = ctx2d(cv);
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const dark = [PAL.ink, PAL.navy].map((hex) => parseInt(hex.slice(1), 16));
  for (let i = 0; i < img.data.length; i += 4) {
    const rgb = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    if (dark.includes(rgb)) img.data[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Logo copy with a moving diagonal highlight painted onto its letter fills. */
class ShimmerLogo {
  private readonly base = scaleCanvas(getLogo(), LOGO_SCALE);
  private readonly mask = fillMask(this.base);
  private readonly work = makeCanvas(this.base.width, this.base.height);
  private readonly wctx = ctx2d(this.work);
  private readonly glint = makeCanvas(this.base.width, this.base.height);
  private readonly gctx = ctx2d(this.glint);

  get width(): number {
    return this.base.width;
  }

  /** Highlight band restricted to the letter fills, for this instant. */
  private paintGlint(t: number): void {
    const { gctx, glint, mask } = this;
    gctx.globalCompositeOperation = 'source-over';
    gctx.clearRect(0, 0, glint.width, glint.height);
    gctx.drawImage(mask, 0, 0);
    gctx.globalCompositeOperation = 'source-in';
    const sweep = ((t % SHIMMER_PERIOD_MS) / SHIMMER_PERIOD_MS) * (glint.width + 120) - 60;
    for (let y = 0; y < glint.height; y += 2) {
      const x = Math.round(sweep - y / 2);
      gctx.fillStyle = 'rgba(252, 252, 252, 0.75)';
      gctx.fillRect(x, y, 8, 2);
      gctx.fillStyle = 'rgba(228, 248, 252, 0.4)';
      gctx.fillRect(x + 10, y, 4, 2);
    }
  }

  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, t: number): void {
    const { wctx, work, base } = this;
    this.paintGlint(t);
    wctx.clearRect(0, 0, work.width, work.height);
    wctx.drawImage(base, 0, 0);
    wctx.drawImage(this.glint, 0, 0);
    for (let x = 0; x < work.width; x += 2) {
      const dy = Math.round(Math.sin(t / 320 + x / 18) * 1.4);
      ctx.drawImage(work, x, 0, 2, work.height, x0 + x, y0 + dy, 2, work.height);
    }
  }
}

/** Run the title scene on the frame canvas until `scope` is disposed. */
export function runTitleScene(scope: Scope): void {
  const sky = paintSky();
  const sand = paintSand();
  const logo = new ShimmerLogo();
  const actors = new TitleActors({ top: SAND_TOP + 14, bottom: frame.H - 6, width: frame.W });
  let last = -Infinity;
  const paint = (now: number) => {
    if (now - last < FRAME_MS) return;
    last = now;
    const ctx = frame.ctx;
    ctx.drawImage(sky, 0, 0);
    drawCloud(ctx, Math.round(((now / 90) % (frame.W + 60)) - 60), 94, 44);
    drawCloud(ctx, Math.round(((now / 140 + 150) % (frame.W + 60)) - 60), 108, 30);
    drawSea(ctx, now);
    ctx.drawImage(sand, 0, SAND_TOP);
    actors.update(now);
    actors.draw(ctx, now, settings.get().colorblind);
    logo.draw(ctx, Math.round((frame.W - logo.width) / 2), LOGO_Y, now);
  };
  paint(performance.now());
  scope.loop(paint);
}
