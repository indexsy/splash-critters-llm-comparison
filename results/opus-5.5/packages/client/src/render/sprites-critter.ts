// Composite critters: animal body + hat in one cached canvas, and HUD head portraits.
import type { AnimalId, DirCode, HatId } from '@splash/shared';
import { PAL, slotColor } from './palette';
import { PixelGrid, cached, ctx2d, makeCanvas } from './pixelart';
import { animalGrid, facingOf, hatPlacement, type Facing } from './sprites-animals';
import { hatFrameCount, hatGrid } from './sprites-hats';

/** Composite critter canvas size: the 16x16 body box sits CRITTER_OY rows down. */
export const CRITTER_W = 16;
export const CRITTER_H = 20;
export const CRITTER_OY = 4;

/** Critter (body + hat) as a pixel grid, in composite coordinates. */
export function critterGrid(
  animal: AnimalId,
  hat: HatId,
  facing: Facing,
  frame: number,
  slot: number,
  colorblind: boolean,
  hatFrame: number,
): PixelGrid {
  const g = new PixelGrid(CRITTER_W, CRITTER_H);
  g.blit(animalGrid(animal, facing, frame, slot, colorblind), 0, CRITTER_OY);
  const h = hatGrid(hat, facing, hatFrame);
  if (h) {
    const at = hatPlacement(animal, facing, frame, h.w, h.h);
    g.blit(h, at.x, at.y + CRITTER_OY);
  }
  return g;
}

/**
 * Cached critter with its hat, CRITTER_W x CRITTER_H. Draw it at (boxX, boxY - CRITTER_OY)
 * where (boxX, boxY) is the top-left of the critter's 16x16 box. `hatFrame` animates the
 * propeller cap (pass a running counter while moving, 0 otherwise).
 */
export function getCritter(
  animal: AnimalId,
  hat: HatId,
  dir: DirCode,
  frame: number,
  slot: number,
  colorblind: boolean,
  hatFrame = 0,
): HTMLCanvasElement {
  const facing = facingOf(dir);
  const hf = hatFrame % hatFrameCount(hat);
  return cached(`critter:${animal}:${hat}:${facing}:${frame}:${slot}:${colorblind ? 1 : 0}:${hf}`, () =>
    critterGrid(animal, hat, facing, frame, slot, colorblind, hf).toCanvas(),
  );
}

export const PORTRAIT_SIZE = 14;

/**
 * 14x14 HUD head portrait: a slot-coloured rounded frame around a 12x12 crop of the
 * front-facing critter (head + hat).
 */
export function getPortrait(animal: AnimalId, hat: HatId, slot: number, colorblind = false): HTMLCanvasElement {
  return cached(`portrait:${animal}:${hat}:${slot}:${colorblind ? 1 : 0}`, () => {
    const sc = slotColor(slot, colorblind);
    const g = new PixelGrid(PORTRAIT_SIZE, PORTRAIT_SIZE);
    g.rect(1, 0, PORTRAIT_SIZE - 2, PORTRAIT_SIZE, sc.dark).rect(0, 1, PORTRAIT_SIZE, PORTRAIT_SIZE - 2, sc.dark);
    g.rect(1, 1, PORTRAIT_SIZE - 2, PORTRAIT_SIZE - 2, sc.light);
    const critter = critterGrid(animal, hat, 'down', 0, slot, colorblind, 0);
    const top = hat === 'none' ? CRITTER_OY : CRITTER_OY - 2;
    const crop = critter.crop(2, top, PORTRAIT_SIZE - 2, PORTRAIT_SIZE - 2);
    g.blit(crop, 1, 1);
    g.set(1, 1, sc.dark).set(PORTRAIT_SIZE - 2, 1, sc.dark);
    g.set(1, PORTRAIT_SIZE - 2, sc.dark).set(PORTRAIT_SIZE - 2, PORTRAIT_SIZE - 2, sc.dark);
    return g.toCanvas();
  });
}

/** Soft translucent oval ground shadow under critters and balloons (w x 4). */
export function getShadow(w = 12): HTMLCanvasElement {
  return cached(`shadow:${w}`, () => {
    const solid = new PixelGrid(w, 4).ellipse((w - 1) / 2, 1.5, w / 2 - 0.5, 1.5, PAL.ink).toCanvas();
    const cv = makeCanvas(w, 4);
    const ctx = ctx2d(cv);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(solid, 0, 0);
    return cv;
  });
}
