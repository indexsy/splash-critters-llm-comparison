/**
 * The sprite surface the rest of the client draws through.
 *
 * Everything here takes a centre point in stage pixels and lands on whole
 * pixels, so a sprite never blurs no matter what the stage scale is. The soak
 * animation lives here rather than in the species art because it is a pose
 * applied to a critter, not a property of any one animal.
 */

import { Dir, animalDef, type AnimalId, type DirValue, type HatId } from '@splash/shared';
import { splashColors } from './palette';
import { Pen, blob } from './pen';
import { critterColors, drawSpecies, drawSpeciesIcon, headBox, spriteFacing } from './critters';
import { drawHat, drawHatIcon } from './hats';

export { drawBalloon, drawPowerup, drawLob, drawLogo } from './props';

export interface CritterLook {
  slot: number;
  animal: AnimalId;
  hat: HatId;
}

export interface CritterOptions {
  /** 0..1 death animation progress. Omit or 0 for a living critter. */
  soakProgress?: number;
  /** Soaked players paddling the border render translucent. */
  ghost?: boolean;
  /** Used for previews of locked cosmetics and for spectated critters. */
  dim?: boolean;
}

interface Pose {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  facing: DirValue;
  alpha: number;
}

const SPIN: DirValue[] = [Dir.DOWN, Dir.RIGHT, Dir.UP, Dir.LEFT];

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function soakPose(p: number, dramatic: boolean, facing: DirValue): Pose {
  if (!dramatic) {
    return {
      offsetX: 0,
      // A small pop before the critter pancakes onto the tile.
      offsetY: -Math.round(Math.sin(Math.min(1, p * 3) * Math.PI) * 2),
      scaleX: 1 + 0.4 * p,
      scaleY: 1 - 0.72 * p,
      facing,
      alpha: 1 - p * p,
    };
  }
  // Cats hate water: leap, spin, flail, then flop.
  if (p < 0.55) {
    const q = p / 0.55;
    return {
      offsetX: Math.round(Math.sin(p * 38)),
      offsetY: -Math.round(Math.sin(q * Math.PI) * 12),
      scaleX: 1,
      scaleY: 1,
      facing: SPIN[Math.floor(q * 8) % SPIN.length],
      alpha: 1,
    };
  }
  const q = (p - 0.55) / 0.45;
  return {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1 + 0.55 * q,
    scaleY: 1 - 0.85 * q,
    facing: Dir.DOWN,
    alpha: 1 - q * q,
  };
}

/** Droplets thrown outward as the critter bursts into water. */
function drawSoakSpray(ctx: CanvasRenderingContext2D, px: number, py: number, p: number): void {
  const colors = splashColors();
  const radius = 3 + p * 13;
  const cx = Math.round(px);
  const cy = Math.round(py);
  const size = p < 0.5 ? 2 : 1;
  ctx.globalAlpha = clamp01(1 - p);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + p;
    const distance = radius * (i % 2 === 0 ? 1 : 0.7);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(
      Math.round(cx + Math.cos(angle) * distance),
      Math.round(cy + Math.sin(angle) * distance) - 2,
      size,
      size,
    );
  }
  ctx.globalAlpha = 1;
}

export function drawCritter(
  ctx: CanvasRenderingContext2D,
  look: CritterLook,
  px: number,
  py: number,
  facing: DirValue,
  frame: number,
  opts: CritterOptions = {},
): void {
  const colors = critterColors(look.animal, look.slot);
  const soak = clamp01(opts.soakProgress ?? 0);
  const pose =
    soak > 0
      ? soakPose(soak, animalDef(look.animal).dramaticSoak === true, facing)
      : { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, facing, alpha: 1 };

  let alpha = pose.alpha;
  if (opts.ghost) alpha *= 0.55;
  if (opts.dim) alpha *= 0.6;
  if (alpha <= 0.02) return;

  const drawn = spriteFacing(pose.facing);
  const originX = Math.round(px) - 8 + pose.offsetX;
  const originY = Math.round(py) - 8 + pose.offsetY;
  const pen = new Pen(ctx, originX, originY)
    .mirror(pose.facing === Dir.LEFT)
    .squash(pose.scaleX, pose.scaleY, 15);

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  drawSpecies(pen, look.animal, colors, drawn, frame);
  drawHat(pen, look.hat, headBox(look.animal, drawn, frame), frame);
  ctx.globalAlpha = previousAlpha;

  if (soak > 0) drawSoakSpray(ctx, px, py, soak);
}

/** 8x8 portrait, centred on (px, py). Used by the HUD, lobby rows and locker. */
export function drawCritterIcon(
  ctx: CanvasRenderingContext2D,
  look: CritterLook,
  px: number,
  py: number,
): void {
  const colors = critterColors(look.animal, look.slot);
  const pen = new Pen(ctx, Math.round(px) - 4, Math.round(py) - 4, 8);
  drawSpeciesIcon(pen, look.animal, colors);
  drawHatIcon(pen, look.hat);
}

const DUCK = {
  body: '#ffd93d',
  shade: '#c9a419',
  belly: '#fff3b0',
  bill: '#ff9f2e',
  outline: '#5a3a06',
  ripple: '#7fdcff',
};

/**
 * A soaked critter riding its rubber duck around the border. The rider is drawn
 * first and the duck's hull over the top, which hides the legs for free.
 */
export function drawDuck(
  ctx: CanvasRenderingContext2D,
  look: CritterLook,
  px: number,
  py: number,
  frame: number,
): void {
  drawCritter(ctx, look, px, py - 5, Dir.DOWN, frame);

  const pen = new Pen(ctx, Math.round(px) - 8, Math.round(py) - 8);
  // Tail cocked up at the back.
  pen.rect(-2, 6, 4, 4, DUCK.body);
  pen.rect(-2, 6, 1, 4, DUCK.outline);
  pen.rect(-2, 5, 3, 1, DUCK.body);
  // Hull, tapered top and bottom so it floats rather than sits in a crate.
  pen.rect(2, 9, 12, 1, DUCK.shade);
  pen.rect(0, 10, 16, 4, DUCK.body);
  pen.rect(1, 14, 14, 1, DUCK.body);
  pen.rect(3, 12, 10, 2, DUCK.belly);
  pen.rect(0, 10, 16, 1, DUCK.shade);
  pen.rect(1, 15, 14, 1, DUCK.outline);
  // Head and bill leaning forward over the water.
  blob(pen, 10, 2, 5, 7, DUCK.body, DUCK.outline);
  pen.rect(15, 5, 3, 2, DUCK.bill);
  pen.rect(15, 6, 3, 1, DUCK.outline);
  pen.dot(12, 4, DUCK.outline);
  // Ripples breaking at the waterline on both sides of the hull.
  const swell = frame === 0 ? 0 : 1;
  pen.rect(-3 - swell, 15, 3, 1, DUCK.ripple);
  pen.rect(15 + swell, 15, 3, 1, DUCK.ripple);
}
