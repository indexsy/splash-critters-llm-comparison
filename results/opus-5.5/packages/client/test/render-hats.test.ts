// Hats are baked into the composite critter canvas (getCritter, CRITTER_W x CRITTER_H), so a
// hat pixel placed outside it is silently cut off in game. Regression: the turtle's side-view
// head sits near the box edge and used to push the bucket, snorkel and bandana off-canvas.
import { ANIMAL_IDS, HAT_IDS, type AnimalId, type HatId } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { ANIMAL_ART, ANIMAL_FRAME_COUNT, ANIMAL_SIZE, baseFacing, hatPlacement, type Facing } from '../src/render/sprites-animals';
import { CRITTER_H, CRITTER_OY, CRITTER_W, critterGrid } from '../src/render/sprites-critter';
import { hatFrameCount, hatGrid } from '../src/render/sprites-hats';

const FACINGS: readonly Facing[] = ['down', 'up', 'left', 'right'];

interface Combo {
  animal: AnimalId;
  hat: HatId;
  facing: Facing;
  frame: number;
  hatFrame: number;
}

function everyHatCombo(): Combo[] {
  const out: Combo[] = [];
  for (const animal of ANIMAL_IDS) {
    for (const hat of HAT_IDS) {
      if (hat === 'none') continue;
      for (const facing of FACINGS) {
        for (let frame = 0; frame < ANIMAL_FRAME_COUNT; frame++) {
          for (let hatFrame = 0; hatFrame < hatFrameCount(hat); hatFrame++) out.push({ animal, hat, facing, frame, hatFrame });
        }
      }
    }
  }
  return out;
}

function label(c: Combo): string {
  return `${c.animal}/${c.hat}/${c.facing}/frame${c.frame}/hat${c.hatFrame}`;
}

describe('hat placement on composite critters', () => {
  const combos = everyHatCombo();

  it('includes the turtle side views that used to clip', () => {
    for (const hat of ['bucket', 'snorkel', 'bandana'] as const) {
      for (const facing of ['left', 'right'] as const) {
        expect(combos.some((c) => c.animal === 'turtle' && c.hat === hat && c.facing === facing)).toBe(true);
      }
    }
  });

  it('keeps every hat pixel inside the composite canvas and draws it there', () => {
    const lost: string[] = [];
    for (const c of combos) {
      const hat = hatGrid(c.hat, c.facing, c.hatFrame);
      if (!hat) throw new Error(`no hat grid for ${label(c)}`);
      const at = hatPlacement(c.animal, c.facing, c.frame, hat.w, hat.h);
      const composite = critterGrid(c.animal, c.hat, c.facing, c.frame, 1, false, c.hatFrame);
      let missing = 0;
      for (let y = 0; y < hat.h; y++) {
        for (let x = 0; x < hat.w; x++) {
          const color = hat.get(x, y);
          if (!color) continue;
          const cx = at.x + x;
          const cy = at.y + CRITTER_OY + y;
          const inside = cx >= 0 && cy >= 0 && cx < CRITTER_W && cy < CRITTER_H;
          if (!inside || composite.get(cx, cy) !== color) missing++;
        }
      }
      if (missing) lost.push(`${label(c)}: ${missing}px`);
    }
    expect(lost).toEqual([]);
  });

  it('never slides a hat off its head: the fill still spans the anchor column', () => {
    const offHead: string[] = [];
    for (const c of combos) {
      const hat = hatGrid(c.hat, c.facing, c.hatFrame);
      if (!hat) continue;
      const at = hatPlacement(c.animal, c.facing, c.frame, hat.w, hat.h);
      const [anchor] = ANIMAL_ART[c.animal].hat[baseFacing(c.facing)];
      const column = c.facing === 'right' ? ANIMAL_SIZE - 1 - anchor : anchor;
      if (column < at.x + 1 || column > at.x + hat.w - 2) offHead.push(`${label(c)}: fill ${at.x + 1}..${at.x + hat.w - 2}, anchor ${column}`);
    }
    expect(offHead).toEqual([]);
  });
});
