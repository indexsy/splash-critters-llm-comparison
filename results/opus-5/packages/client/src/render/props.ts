/**
 * Everything on the field that is not a critter: balloons, power-up pickups,
 * revenge-duck lobs and the title wordmark. These are re-exported from
 * sprites.ts, which is the single import site the rest of the client uses.
 */

import type { PowerupType } from '@splash/shared';
import { SLOT_COLORS, UI, tint } from './palette';
import { Pen, blob, fillDisc } from './pen';
import { GLYPH_ADVANCE, drawText, textWidth } from './text';

const BALLOON = {
  skin: '#4fa9f0',
  shine: '#a8ecff',
  deep: '#1f5fae',
  knot: '#123a5e',
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function slotColor(slot: number): string {
  const count = SLOT_COLORS.length;
  return SLOT_COLORS[((Math.floor(slot) % count) + count) % count];
}

/**
 * The balloon swells and wobbles faster the closer its fuse gets to zero, which
 * is the only warning a player gets that a tile is about to become water.
 */
export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  fuseProgress: number,
  ownerSlot: number,
): void {
  const p = clamp01(fuseProgress);
  const cx = Math.round(px);
  const cy = Math.round(py);
  const phase = p * (16 + 70 * p);
  const wobble = Math.round(Math.sin(phase));
  const base = 4 + Math.round(p * 2);
  const rx = Math.max(2, base + wobble);
  const ry = Math.max(2, base - wobble);

  // The ring is the owner's slot colour so a crowded tile still reads clearly.
  fillDisc(ctx, cx, cy, rx + 1, ry + 1, slotColor(ownerSlot));
  const flashing = p > 0.86 && Math.sin(phase * 2) > 0;
  fillDisc(ctx, cx, cy, rx, ry, flashing ? BALLOON.shine : BALLOON.skin);
  fillDisc(ctx, cx, cy + Math.max(1, ry - 2), rx - 1, 2, BALLOON.deep);
  ctx.fillStyle = BALLOON.shine;
  ctx.fillRect(cx - rx + 2, cy - ry + 2, 2, 2);
  ctx.fillStyle = BALLOON.knot;
  ctx.fillRect(cx - 1, cy - ry - 2, 2, 2);
}

// ------------------------------------------------------------------ pickups

const PICKUP = {
  plus: '#ffffff',
  plusShadow: '#1b3a5c',
  splashLight: '#a8ecff',
  splashDeep: '#2b6fd6',
  finBlade: '#39c6c0',
  finDark: '#125a58',
  boot: '#ffb03a',
  bootDark: '#8a5510',
  sole: '#3a2a12',
};

/** Rows of a round balloon, so the icon never reads as a blue box. */
const BALLOON_ROWS: [number, number, number][] = [
  [3, 4, 4], [4, 3, 6], [5, 2, 8], [6, 2, 8],
  [7, 2, 8], [8, 2, 8], [9, 3, 6], [10, 3, 6], [11, 4, 4],
];

function drawExtraBalloonIcon(pen: Pen): void {
  for (const [y, x, w] of BALLOON_ROWS) pen.rect(x, y, w, 1, BALLOON.knot);
  BALLOON_ROWS.forEach(([y, x, w], i) => {
    if (i === 0 || i === BALLOON_ROWS.length - 1) return;
    pen.rect(x + 1, y, w - 2, 1, i > 4 ? BALLOON.deep : BALLOON.skin);
  });
  pen.rect(4, 5, 2, 2, BALLOON.shine);
  pen.rect(5, 12, 2, 1, BALLOON.knot);
  pen.rect(12, 3, 2, 8, PICKUP.plusShadow);
  pen.rect(9, 6, 8, 2, PICKUP.plusShadow);
  pen.rect(12, 4, 2, 6, PICKUP.plus);
  pen.rect(10, 6, 6, 2, PICKUP.plus);
}

function drawBigSplashIcon(pen: Pen, phase: number): void {
  // The arms breathe outward one pixel, matching the burst they represent.
  const reach = Math.sin(phase) > 0 ? 1 : 0;
  blob(pen, 5, 5, 6, 6, PICKUP.splashLight, PICKUP.splashDeep);
  pen.rect(7, 7, 2, 2, '#ffffff');
  pen.rect(7, 1 - reach, 2, 3 + reach, PICKUP.splashLight);
  pen.rect(7, 12, 2, 3 + reach, PICKUP.splashLight);
  pen.rect(1 - reach, 7, 3 + reach, 2, PICKUP.splashLight);
  pen.rect(12, 7, 3 + reach, 2, PICKUP.splashLight);
  pen.dot(3, 3, PICKUP.splashDeep);
  pen.dot(12, 12, PICKUP.splashDeep);
}

/**
 * A narrow foot pocket over a blade that flares outward and tapers to a tip.
 * The asymmetry is what stops a pair of fins reading as a pair of bottles.
 */
const FIN_POCKET: [number, number, number][] = [[2, 3, 3], [3, 3, 3], [4, 2, 4]];
const FIN_BLADE: [number, number, number][] = [
  [5, 2, 5], [6, 1, 6], [7, 0, 7], [8, 0, 7], [9, 0, 7], [10, 1, 6], [11, 2, 5],
];

function drawFin(pen: Pen, ox: number, flip: boolean): void {
  const put = (y: number, x: number, w: number, color: string): void => {
    pen.rect(ox + (flip ? 8 - x - w : x), y, w, 1, color);
  };
  for (const [y, x, w] of FIN_POCKET) put(y, x, w, PICKUP.finDark);
  put(3, 4, 1, tint(PICKUP.finDark, 0.45));
  for (const [y, x, w] of FIN_BLADE) put(y, x, w, PICKUP.finBlade);
  for (const [y, x] of FIN_BLADE) put(y, x, 1, PICKUP.finDark);
  for (let y = 6; y <= 10; y++) put(y, 4, 1, tint(PICKUP.finBlade, 0.45));
  put(12, 3, 3, PICKUP.finDark);
}

function drawFlippersIcon(pen: Pen): void {
  drawFin(pen, 0, false);
  drawFin(pen, 8, true);
}

function drawBootsIcon(pen: Pen): void {
  pen.rect(3, 1, 8, 2, PICKUP.bootDark);
  pen.rect(4, 3, 6, 7, PICKUP.boot);
  pen.rect(4, 3, 2, 7, tint(PICKUP.boot, 0.25));
  pen.rect(4, 10, 9, 3, PICKUP.boot);
  pen.rect(10, 10, 3, 1, tint(PICKUP.boot, 0.25));
  pen.rect(3, 13, 11, 2, PICKUP.sole);
  pen.rect(4, 6, 6, 1, PICKUP.bootDark);
}

export function drawPowerup(
  ctx: CanvasRenderingContext2D,
  type: PowerupType,
  px: number,
  py: number,
  bobPhase: number,
): void {
  const bob = Math.round(Math.sin(bobPhase) * 2);
  const cx = Math.round(px);
  const cy = Math.round(py);
  // A shadow that shrinks as the pickup rises sells the hover.
  ctx.globalAlpha = 0.3;
  fillDisc(ctx, cx, cy + 7, Math.max(2, 5 - Math.abs(bob)), 2, UI.shadow);
  ctx.globalAlpha = 1;
  const pen = new Pen(ctx, cx - 8, cy - 8 + bob);
  switch (type) {
    case 'extra_balloon':
      drawExtraBalloonIcon(pen);
      break;
    case 'big_splash':
      drawBigSplashIcon(pen, bobPhase);
      break;
    case 'flippers':
      drawFlippersIcon(pen);
      break;
    default:
      drawBootsIcon(pen);
      break;
  }
}

/** A lobbed balloon in flight: it tumbles, so the knot orbits the body. */
export function drawLob(ctx: CanvasRenderingContext2D, px: number, py: number, spin: number): void {
  const cx = Math.round(px);
  const cy = Math.round(py);
  const knotX = cx + Math.round(Math.cos(spin) * 5);
  const knotY = cy + Math.round(Math.sin(spin) * 5);
  fillDisc(ctx, cx, cy, 5, 5, BALLOON.knot);
  fillDisc(ctx, cx, cy, 4, 4, BALLOON.skin);
  ctx.fillStyle = BALLOON.shine;
  ctx.fillRect(cx - Math.round(Math.cos(spin) * 2) - 1, cy - Math.round(Math.sin(spin) * 2) - 1, 2, 2);
  ctx.fillStyle = BALLOON.knot;
  ctx.fillRect(knotX - 1, knotY - 1, 2, 2);
  ctx.fillStyle = BALLOON.shine;
  ctx.fillRect(cx - Math.round(Math.cos(spin) * 7), cy - Math.round(Math.sin(spin) * 7), 1, 1);
}

// -------------------------------------------------------------------- logo

const LOGO_CYCLE = ['#ffffff', '#a8ecff', '#7fdcff', '#4fa9f0'];

function drawWord(ctx: CanvasRenderingContext2D, word: string, cx: number, y: number, t: number): number {
  const scale = 3;
  const width = textWidth(word, scale);
  const startX = Math.round(cx - width / 2);
  for (let i = 0; i < word.length; i++) {
    const color = LOGO_CYCLE[(i + Math.floor(t * 6)) % LOGO_CYCLE.length];
    const bob = Math.round(Math.sin(t * 4 + i * 0.7) * 2);
    drawText(ctx, word[i], startX + i * GLYPH_ADVANCE * scale, y + bob, color, {
      scale,
      shadow: UI.shadow,
    });
  }
  return width;
}

/** The animated wordmark. `t` is seconds since the title screen mounted. */
export function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number): void {
  // Each letter bobs by up to 2px in drawWord, so the two lines need more than
  // one glyph height between them or the descenders of SPLASH land on the caps
  // of CRITTERS. 34px leaves 6px of daylight at the worst phase.
  const topY = Math.round(cy - 28);
  const width = drawWord(ctx, 'SPLASH', cx, topY, t);
  drawWord(ctx, 'CRITTERS', cx, Math.round(cy + 6), t + 0.4);

  // A droplet skips across the top of the wordmark and bounces as it goes.
  const span = width + 24;
  const travel = (t * 46) % span;
  const dropX = Math.round(cx - span / 2 + travel);
  const hop = Math.abs(Math.sin(t * 3.4));
  const dropY = Math.round(topY - 6 - hop * 8);
  ctx.fillStyle = LOGO_CYCLE[2];
  ctx.fillRect(dropX - 1, dropY, 4, 4);
  ctx.fillRect(dropX, dropY - 3, 2, 3);
  ctx.fillStyle = LOGO_CYCLE[1];
  ctx.fillRect(dropX - 1, dropY + 3, 4, 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(dropX, dropY + 1, 1, 1);
}
