/**
 * The cast, drawn as pixels.
 *
 * Every species shares one skeleton - legs, body, belly, neck scarf, head, ears,
 * face - and differs by a compact table of measurements plus a handful of feature
 * flags. That keeps eight distinct silhouettes readable at 16x16 without eight
 * hand-tuned sprite sheets, and it means a tweak to (say) how a leg lifts on the
 * walk cycle lands on the whole cast at once.
 *
 * The slot-coloured scarf is not decoration: two players may pick the same
 * animal, so the band at the neck is the only guaranteed way to tell them apart.
 */

import { Dir, animalDef, type AnimalId, type DirValue } from '@splash/shared';
import { SLOT_COLORS, SLOT_DARK, shade, tint } from './palette';
import { Pen, blob } from './pen';

export interface CritterColors {
  outline: string;
  body: string;
  belly: string;
  slot: string;
  slotDark: string;
}

export function critterColors(animal: AnimalId, slot: number): CritterColors {
  const def = animalDef(animal);
  const count = SLOT_COLORS.length;
  const index = ((Math.floor(slot) % count) + count) % count;
  return {
    outline: def.palette[0],
    body: def.palette[1],
    belly: def.palette[2],
    slot: SLOT_COLORS[index],
    slotDark: SLOT_DARK[index],
  };
}

type EarKind = 'none' | 'round' | 'pointed';
type TailKind = 'none' | 'stub' | 'thin' | 'flat' | 'ringed';
type MuzzleKind = 'wide' | 'bill' | 'beak' | 'blunt' | 'small';
type FootKind = 'paw' | 'web';

interface Spec {
  bodyW: number;
  bodyTop: number;
  bodyH: number;
  headW: number;
  headTop: number;
  headH: number;
  legW: number;
  foot: FootKind;
  ears: EarKind;
  tail: TailKind;
  muzzle: MuzzleKind;
  /** Eye row measured down from the top of the head. */
  eyeRow: number;
  /** Half the gap between the two eyes, in pixels. */
  eyeSpread: number;
  eyeSize: number;
  bellyH: number;
  bellyW: number;
  shell: boolean;
  mask: boolean;
  flippers: boolean;
  /** Frog eyes sit proud of the skull. */
  bulge: boolean;
}

/** Every body ends at row 14 so the two-pixel legs always land on row 15. */
const SPECS: Record<AnimalId, Spec> = {
  frog: {
    bodyW: 11, bodyTop: 8, bodyH: 6, headW: 13, headTop: 2, headH: 7,
    legW: 3, foot: 'web', ears: 'none', tail: 'none', muzzle: 'wide',
    eyeRow: 1, eyeSpread: 4, eyeSize: 2, bellyH: 3, bellyW: 7, shell: false,
    mask: false, flippers: false, bulge: true,
  },
  duck: {
    bodyW: 10, bodyTop: 7, bodyH: 7, headW: 9, headTop: 1, headH: 6,
    legW: 3, foot: 'web', ears: 'none', tail: 'stub', muzzle: 'bill',
    eyeRow: 2, eyeSpread: 3, eyeSize: 1, bellyH: 4, bellyW: 6, shell: false,
    mask: false, flippers: false, bulge: false,
  },
  otter: {
    bodyW: 14, bodyTop: 9, bodyH: 5, headW: 9, headTop: 4, headH: 6,
    legW: 3, foot: 'paw', ears: 'round', tail: 'flat', muzzle: 'small',
    eyeRow: 2, eyeSpread: 2, eyeSize: 1, bellyH: 2, bellyW: 6, shell: false,
    mask: false, flippers: false, bulge: false,
  },
  penguin: {
    bodyW: 10, bodyTop: 6, bodyH: 8, headW: 9, headTop: 1, headH: 6,
    legW: 3, foot: 'web', ears: 'none', tail: 'none', muzzle: 'beak',
    eyeRow: 2, eyeSpread: 2, eyeSize: 1, bellyH: 5, bellyW: 6, shell: false,
    mask: false, flippers: true, bulge: false,
  },
  cat: {
    bodyW: 10, bodyTop: 9, bodyH: 5, headW: 10, headTop: 3, headH: 7,
    legW: 3, foot: 'paw', ears: 'pointed', tail: 'thin', muzzle: 'small',
    eyeRow: 3, eyeSpread: 2, eyeSize: 2, bellyH: 2, bellyW: 4, shell: false,
    mask: false, flippers: false, bulge: false,
  },
  raccoon: {
    bodyW: 11, bodyTop: 9, bodyH: 5, headW: 11, headTop: 3, headH: 7,
    legW: 3, foot: 'paw', ears: 'round', tail: 'ringed', muzzle: 'small',
    eyeRow: 3, eyeSpread: 3, eyeSize: 2, bellyH: 2, bellyW: 5, shell: false,
    mask: true, flippers: false, bulge: false,
  },
  turtle: {
    bodyW: 14, bodyTop: 8, bodyH: 6, headW: 7, headTop: 3, headH: 6,
    legW: 3, foot: 'paw', ears: 'none', tail: 'stub', muzzle: 'small',
    eyeRow: 2, eyeSpread: 2, eyeSize: 1, bellyH: 0, bellyW: 0, shell: true,
    mask: false, flippers: false, bulge: false,
  },
  capybara: {
    bodyW: 13, bodyTop: 8, bodyH: 6, headW: 11, headTop: 3, headH: 6,
    legW: 3, foot: 'paw', ears: 'round', tail: 'stub', muzzle: 'blunt',
    eyeRow: 2, eyeSpread: 3, eyeSize: 1, bellyH: 3, bellyW: 7, shell: false,
    mask: false, flippers: false, bulge: false,
  },
};

interface Geometry {
  headX: number;
  headY: number;
  bodyX: number;
  bodyY: number;
  side: boolean;
  back: boolean;
}

const CENTRE = 8;

function boxLeft(width: number): number {
  return CENTRE - Math.floor(width / 2);
}

/** LEFT is drawn as RIGHT under a mirror, and a standing critter faces down. */
export function spriteFacing(facing: DirValue): DirValue {
  if (facing === Dir.LEFT) return Dir.RIGHT;
  if (facing === Dir.NONE) return Dir.DOWN;
  return facing;
}

function geometryFor(spec: Spec, facing: DirValue, frame: number): Geometry {
  const bob = frame === 1 ? 1 : 0;
  const side = facing === Dir.RIGHT;
  // A profile leans its head forward, which is most of what sells the turn.
  const lean = side ? (spec.headW > 10 ? 1 : 2) : 0;
  return {
    headX: boxLeft(spec.headW) + lean,
    headY: spec.headTop + bob,
    bodyX: boxLeft(spec.bodyW),
    bodyY: spec.bodyTop + bob,
    side,
    back: facing === Dir.UP,
  };
}

/** Where a hat has to sit. Facing must already be normalised by spriteFacing. */
export function headBox(
  animal: AnimalId,
  facing: DirValue,
  frame: number,
): { x: number; y: number; w: number; h: number } {
  const spec = SPECS[animal];
  const geo = geometryFor(spec, facing, frame);
  return { x: geo.headX, y: geo.headY, w: spec.headW, h: spec.headH };
}

// ------------------------------------------------------------------- pieces

function drawLegs(pen: Pen, c: CritterColors, spec: Spec, frame: number): void {
  const foot = spec.foot === 'web' ? shade(c.belly, 0.35) : shade(c.body, 0.3);
  const inset = spec.foot === 'web' ? 1 : 2;
  const leftX = spec.bodyW >= 12 ? boxLeft(spec.bodyW) + inset + 1 : boxLeft(spec.bodyW) + inset;
  const rightX = boxLeft(spec.bodyW) + spec.bodyW - inset - spec.legW - (spec.bodyW >= 12 ? 1 : 0);

  // The lifted leg swaps every frame, which is the whole walk cycle.
  const lift: [number, number] = frame === 0 ? [0, 1] : [1, 0];
  const legs: [number, number][] = [
    [leftX, lift[0]],
    [rightX, lift[1]],
  ];
  for (const [x, raised] of legs) {
    pen.rect(x, 14 + raised, spec.legW, 2 - raised, c.outline);
    pen.rect(x, 14 + raised, spec.legW, 1, shade(c.body, 0.15));
    if (spec.foot === 'web') pen.rect(x - 1, 15, spec.legW + 1, 1, foot);
    else pen.rect(x, 15, spec.legW, 1, foot);
  }
}

/** Tails always start flush against the body's back edge, never floating. */
function drawTail(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const edge = geo.bodyX;
  const midY = geo.bodyY + Math.floor(spec.bodyH / 2);
  switch (spec.tail) {
    case 'thin':
      // A cat tail hooks up behind the hip so the silhouette reads as feline.
      pen.rect(edge - 2, midY, 2, 2, c.outline);
      pen.rect(edge - 2, midY - 4, 1, 5, c.outline);
      pen.rect(edge - 2, midY - 5, 2, 2, c.body);
      break;
    case 'ringed':
      for (let i = 0; i < 5; i++) {
        pen.rect(edge - 1 - i, midY - 2, 1, 4, i % 2 === 0 ? c.outline : c.belly);
      }
      pen.rect(edge - 6, midY - 1, 1, 2, c.outline);
      break;
    case 'flat':
      pen.rect(edge - 4, midY - 1, 5, 3, c.outline);
      pen.rect(edge - 4, midY, 4, 1, shade(c.body, 0.2));
      break;
    case 'stub':
      pen.rect(edge - 2, midY - 1, 3, 3, c.outline);
      pen.rect(edge - 1, midY - 1, 2, 2, shade(c.body, 0.1));
      break;
    default:
      break;
  }
}

function drawBelly(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  if (spec.bellyH <= 0 || geo.back) return;
  // Narrower than the body so the coat colour still frames it.
  const width = Math.min(spec.bellyW, spec.bodyW - 4);
  const x = geo.side ? geo.bodyX + spec.bodyW - width - 2 : CENTRE - Math.floor(width / 2);
  const y = geo.bodyY + spec.bodyH - spec.bellyH - 1;
  pen.rect(x, y, width, spec.bellyH, c.belly);
  pen.rect(x, y, width, 1, shade(c.belly, 0.15));
}

function drawShell(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const plate = shade(c.body, 0.4);
  const dome = shade(c.body, 0.12);
  const rim = c.belly;
  const left = geo.bodyX + 1;
  const width = spec.bodyW - 2;
  pen.rect(left, geo.bodyY + 1, width, spec.bodyH - 3, dome);
  // Plate seams: three across the dome, two staggered below.
  pen.rect(left, geo.bodyY + 3, width, 1, plate);
  for (const dx of [3, 7, 10]) pen.rect(left + dx, geo.bodyY + 1, 1, 2, plate);
  for (const dx of [5, 9]) pen.rect(left + dx, geo.bodyY + 4, 1, 2, plate);
  pen.rect(left, geo.bodyY + spec.bodyH - 2, width, 1, rim);
}

function drawFlippers(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const wing = shade(c.body, 0.22);
  const top = geo.bodyY + 2;
  pen.rect(geo.bodyX + spec.bodyW - 1, top, 2, 5, wing);
  pen.rect(geo.bodyX + spec.bodyW, top + 4, 1, 1, c.outline);
  if (geo.side) return;
  pen.rect(geo.bodyX - 1, top, 2, 5, wing);
  pen.rect(geo.bodyX - 1, top + 4, 1, 1, c.outline);
}

/**
 * A collar rather than a full band: narrow enough that the animal's own colours
 * still dominate, wide enough to identify a player at a glance.
 */
function drawScarf(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const width = Math.max(4, Math.min(spec.headW - 4, spec.bodyW - 4));
  const x = geo.side ? geo.headX + 1 : CENTRE - Math.floor(width / 2);
  const y = geo.bodyY + 1;
  pen.rect(x, y, width, 1, c.slot);
  pen.rect(x, y + 1, width, 1, c.slotDark);
  // One hanging end, on the side away from the face.
  const knotX = geo.side ? x : x + width - 2;
  pen.rect(knotX, y + 2, 2, 2, c.slot);
}

function drawEars(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  if (spec.ears === 'none') return;
  const inner = tint(c.body, 0.45);
  const leftX = geo.headX + 1;
  const rightX = geo.headX + spec.headW - 3;
  if (spec.ears === 'round') {
    for (const x of [leftX, rightX]) {
      pen.rect(x, geo.headY - 2, 3, 3, c.outline);
      pen.rect(x + 1, geo.headY - 1, 1, 1, inner);
    }
    return;
  }
  for (const x of [leftX, rightX]) {
    pen.rect(x, geo.headY - 2, 3, 3, c.outline);
    pen.rect(x + 1, geo.headY - 1, 1, 2, inner);
  }
}

function drawMask(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const brow = tint(c.body, 0.4);
  pen.rect(geo.headX + 1, geo.headY + spec.eyeRow - 1, spec.headW - 2, 1, brow);
  pen.rect(geo.headX + 1, geo.headY + spec.eyeRow, spec.headW - 2, 2, c.outline);
}

function drawEyes(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const white = spec.mask ? c.belly : '#ffffff';
  const y = geo.headY + spec.eyeRow;
  const centre = geo.headX + Math.floor(spec.headW / 2);
  const xs = geo.side
    ? [centre + spec.eyeSpread - 1]
    : [centre - spec.eyeSpread, centre + spec.eyeSpread - (spec.eyeSize - 1)];
  for (const x of xs) {
    if (spec.eyeSize > 1) {
      pen.rect(x, y, spec.eyeSize, spec.eyeSize, white);
      pen.rect(x + (geo.side ? 1 : 0), y + spec.eyeSize - 1, 1, 1, c.outline);
    } else {
      pen.dot(x, y, c.outline);
    }
  }
}

function drawBulgeEyes(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const y = geo.headY - 2;
  const centre = geo.headX + Math.floor(spec.headW / 2);
  const xs = geo.side ? [centre + 2] : [centre - 4, centre + 3];
  for (const x of xs) {
    blob(pen, x, y, 4, 4, '#ffffff', c.outline);
    pen.rect(x + (geo.side ? 2 : 1), y + 1, 1, 2, c.outline);
  }
}

function drawMuzzle(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  const centre = geo.headX + Math.floor(spec.headW / 2);
  const chin = geo.headY + spec.headH;
  switch (spec.muzzle) {
    case 'wide': {
      // The frog's grin runs the full width of the skull.
      const y = chin - 2;
      pen.rect(geo.headX + 2, y, spec.headW - 4, 1, c.outline);
      pen.rect(geo.headX + 2, y - 1, 1, 1, c.outline);
      pen.rect(geo.headX + spec.headW - 3, y - 1, 1, 1, c.outline);
      break;
    }
    case 'bill': {
      const bill = shade(c.body, 0.3);
      if (geo.side) {
        pen.rect(geo.headX + spec.headW - 1, chin - 4, 5, 2, bill);
        pen.rect(geo.headX + spec.headW - 1, chin - 2, 5, 1, c.outline);
      } else {
        pen.rect(centre - 2, chin - 3, 5, 2, bill);
        pen.rect(centre - 2, chin - 1, 5, 1, c.outline);
      }
      break;
    }
    case 'beak': {
      const beak = shade(c.belly, 0.35);
      if (geo.side) {
        pen.rect(geo.headX + spec.headW - 1, chin - 4, 3, 2, beak);
        pen.rect(geo.headX + spec.headW + 1, chin - 3, 1, 1, c.outline);
      } else {
        pen.rect(centre - 1, chin - 3, 3, 2, beak);
        pen.rect(centre, chin - 1, 1, 1, beak);
      }
      break;
    }
    case 'blunt': {
      const snout = tint(c.belly, 0.15);
      const x = geo.side ? geo.headX + spec.headW - 4 : centre - 2;
      pen.rect(x, chin - 3, 5, 2, snout);
      pen.rect(x, chin - 1, 5, 1, shade(snout, 0.35));
      pen.dot(x + 1, chin - 3, c.outline);
      pen.dot(x + 3, chin - 3, c.outline);
      break;
    }
    default: {
      const x = geo.side ? geo.headX + spec.headW - 2 : centre - 1;
      pen.rect(x, chin - 3, 2, 1, c.outline);
      pen.rect(x, chin - 2, 1, 1, c.outline);
      pen.rect(geo.side ? x - 1 : x - 2, chin - 3, 1, 1, tint(c.belly, 0.2));
      break;
    }
  }
}

/** Only in profile: from the front they read as sticks rather than whiskers. */
function drawWhiskers(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  if (!geo.side) return;
  const y = geo.headY + spec.headH - 3;
  pen.rect(geo.headX + spec.headW, y, 2, 1, tint(c.belly, 0.4));
}

function drawBackOfHead(pen: Pen, c: CritterColors, spec: Spec, geo: Geometry): void {
  pen.rect(geo.headX + 2, geo.headY + 2, spec.headW - 4, spec.headH - 4, shade(c.body, 0.14));
  pen.rect(geo.headX + Math.floor(spec.headW / 2) - 1, geo.headY + 1, 2, 2, tint(c.body, 0.25));
}

// --------------------------------------------------------------- assembly

/** Draws one critter body into the pen's 16x16 grid, hat excluded. */
export function drawSpecies(
  pen: Pen,
  animal: AnimalId,
  c: CritterColors,
  facing: DirValue,
  frame: number,
): void {
  const spec = SPECS[animal];
  const geo = geometryFor(spec, facing, frame);

  drawTail(pen, c, spec, geo);
  drawLegs(pen, c, spec, frame);
  blob(pen, geo.bodyX, geo.bodyY, spec.bodyW, spec.bodyH, c.body, c.outline);
  drawBelly(pen, c, spec, geo);
  if (spec.shell) drawShell(pen, c, spec, geo);
  if (spec.flippers) drawFlippers(pen, c, spec, geo);
  drawScarf(pen, c, spec, geo);

  blob(pen, geo.headX, geo.headY, spec.headW, spec.headH, c.body, c.outline);
  drawEars(pen, c, spec, geo);

  if (geo.back) {
    drawBackOfHead(pen, c, spec, geo);
    return;
  }
  if (spec.mask) drawMask(pen, c, spec, geo);
  if (spec.bulge) drawBulgeEyes(pen, c, spec, geo);
  else drawEyes(pen, c, spec, geo);
  drawMuzzle(pen, c, spec, geo);
  if (spec.ears === 'pointed') drawWhiskers(pen, c, spec, geo);
}

/** Head-only 8x8 portrait for the HUD, the locker and the lobby rows. */
export function drawSpeciesIcon(pen: Pen, animal: AnimalId, c: CritterColors): void {
  const spec = SPECS[animal];
  if (spec.ears === 'pointed') {
    pen.rect(1, 0, 2, 2, c.outline);
    pen.rect(5, 0, 2, 2, c.outline);
  } else if (spec.ears === 'round') {
    pen.dot(1, 0, c.outline);
    pen.dot(6, 0, c.outline);
  }
  blob(pen, 0, 1, 8, 6, c.body, c.outline);
  if (spec.mask) pen.rect(1, 3, 6, 2, c.outline);
  if (spec.bulge) {
    pen.rect(1, 1, 2, 2, '#ffffff');
    pen.rect(5, 1, 2, 2, '#ffffff');
    pen.dot(2, 2, c.outline);
    pen.dot(5, 2, c.outline);
  } else {
    pen.dot(2, 3, spec.mask ? c.belly : c.outline);
    pen.dot(5, 3, spec.mask ? c.belly : c.outline);
  }
  if (spec.muzzle === 'bill' || spec.muzzle === 'beak') {
    pen.rect(3, 5, 2, 1, shade(c.body, 0.3));
  } else {
    pen.rect(3, 5, 2, 1, tint(c.belly, 0.1));
  }
  pen.rect(1, 7, 6, 1, c.slot);
}
