// Critter body compositor: turns the per-animal grids into outlined 16x16 frames with
// procedural feet, a slot-coloured scarf and a 2-frame walk cycle (+ idle).
// Frames: 0 idle, 1 step (left/front foot lifted, body bobs 1px), 2 step (other foot).
import { Dir, type AnimalId, type DirCode } from '@splash/shared';
import { FROG, DUCK, OTTER, PENGUIN } from './sprites-animal-grids-a';
import { CAT, RACCOON, TURTLE, CAPYBARA } from './sprites-animal-grids-b';
import { PAL, SLOT_PATTERNS, slotColor } from './palette';
import { PixelGrid, cached, type Legend } from './pixelart';

/** Drawn facing of a sprite. 'right' is 'left' mirrored. */
export type Facing = 'down' | 'up' | 'left' | 'right';
/** Facings that have their own grids. */
export type BaseFacing = 'down' | 'up' | 'left';

export interface AnimalArt {
  /** Colours for the per-animal grid letters (a, b, c, d, e, f, g, y). */
  colors: Record<string, string>;
  /** Rows 0..12 of the 16x16 frame per base facing (16 chars each). */
  down: readonly string[];
  up: readonly string[];
  left: readonly string[];
  foot: string;
  /** Hat anchor per base facing: [centre column, row the hat's bottom edge sits on]. */
  hat: Record<BaseFacing, readonly [number, number]>;
}

export const ANIMAL_ART: Record<AnimalId, AnimalArt> = {
  frog: FROG,
  duck: DUCK,
  otter: OTTER,
  penguin: PENGUIN,
  cat: CAT,
  raccoon: RACCOON,
  turtle: TURTLE,
  capybara: CAPYBARA,
};

export const ANIMAL_SIZE = 16;
export const ANIMAL_FRAME_COUNT = 3;
/** Duration of one walk-cycle step (the cycle is step, idle, step, idle). */
export const WALK_FRAME_MS = 120;
const WALK_CYCLE = [1, 0, 2, 0] as const;

/** Frame index for a critter: idle when still, else the 4-phase walk cycle. */
export function animalFrameAt(moving: boolean, timeMs: number): number {
  if (!moving) return 0;
  return WALK_CYCLE[Math.floor(timeMs / WALK_FRAME_MS) % WALK_CYCLE.length];
}

/** Vertical bob (pixels up) of a frame: step frames lift the body by one pixel. */
function frameBob(frame: number): number {
  return frame === 0 ? 0 : 1;
}

export function facingOf(dir: DirCode): Facing {
  switch (dir) {
    case Dir.Up:
      return 'up';
    case Dir.Left:
      return 'left';
    case Dir.Right:
      return 'right';
    default:
      return 'down';
  }
}

export function baseFacing(f: Facing): BaseFacing {
  return f === 'right' ? 'left' : f;
}

const BASE_LEGEND: Legend = { k: PAL.ink, w: PAL.white, p: PAL.pinkLight };

/**
 * Colour of a slot-coloured cloth pixel. In colourblind mode a per-slot 1-D pattern is
 * applied along x (solid / fine light stripes / wide light stripes / fine dark stripes) so
 * identity never relies on hue alone.
 */
function clothColor(slot: number, colorblind: boolean, x: number, dark: boolean): string {
  const c = slotColor(slot, colorblind);
  if (dark) return c.dark;
  if (!colorblind) return c.main;
  switch (SLOT_PATTERNS[slot % SLOT_PATTERNS.length]) {
    case 1:
      return x % 2 === 0 ? c.main : c.light;
    case 2:
      return (x >> 1) % 2 === 0 ? c.main : c.light;
    case 3:
      return x % 2 === 0 ? c.main : c.dark;
    default:
      return c.main;
  }
}

/** Rasterise grid rows with an animal's colours and the slot cloth letters. */
function paintRows(rows: readonly string[], colors: Record<string, string>, slot: number, colorblind: boolean): PixelGrid {
  const legend: Legend = { ...BASE_LEGEND, ...colors };
  const g = new PixelGrid(ANIMAL_SIZE, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === 's' || ch === 'S') g.set(x, y, clothColor(slot, colorblind, x, ch === 'S'));
      else if (legend[ch]) g.set(x, y, legend[ch]);
    }
  });
  return g;
}

interface FootSpot {
  x: number;
  /** Horizontal nudge when this foot is lifted (side view stride). */
  liftDx: number;
}

const FRONT_FEET: readonly FootSpot[] = [
  { x: 5, liftDx: 0 },
  { x: 9, liftDx: 0 },
];
const SIDE_FEET: readonly FootSpot[] = [
  { x: 5, liftDx: -1 },
  { x: 9, liftDx: 1 },
];

function drawFeet(g: PixelGrid, art: AnimalArt, facing: BaseFacing, frame: number): void {
  const bob = frameBob(frame);
  const spots = facing === 'left' ? SIDE_FEET : FRONT_FEET;
  spots.forEach((spot, i) => {
    const lifted = frame === i + 1;
    const top = 13 - bob;
    const bottom = lifted ? 13 : 14;
    g.rect(spot.x + (lifted ? spot.liftDx : 0), top, 2, bottom - top + 1, art.foot);
  });
}

/** Un-outlined, un-mirrored critter fill (used by soak/ride/portrait compositors). */
export function animalFill(animal: AnimalId, facing: BaseFacing, frame: number, slot: number, colorblind: boolean): PixelGrid {
  const art = ANIMAL_ART[animal];
  const g = new PixelGrid(ANIMAL_SIZE, ANIMAL_SIZE);
  drawFeet(g, art, facing, frame);
  g.blit(paintRows(art[facing], art.colors, slot, colorblind), 0, -frameBob(frame));
  return g;
}

/** Finished critter frame as a pixel grid: outlined in ink and mirrored for 'right'. */
export function animalGrid(animal: AnimalId, facing: Facing, frame: number, slot: number, colorblind: boolean): PixelGrid {
  const g = animalFill(animal, baseFacing(facing), frame, slot, colorblind).outlined(PAL.ink);
  return facing === 'right' ? g.flipX() : g;
}

/** Cached 16x16 critter frame (no hat). `frame` is 0 idle, 1-2 walk steps. */
export function getAnimalFrame(animal: AnimalId, dir: DirCode, frame: number, slot: number, colorblind: boolean): HTMLCanvasElement {
  const facing = facingOf(dir);
  const f = ((frame % ANIMAL_FRAME_COUNT) + ANIMAL_FRAME_COUNT) % ANIMAL_FRAME_COUNT;
  return cached(`animal:${animal}:${facing}:${f}:${slot}:${colorblind ? 1 : 0}`, () =>
    animalGrid(animal, facing, f, slot, colorblind).toCanvas(),
  );
}

/**
 * Where a hat canvas goes on a critter frame: top-left corner in the critter's 16x16 box
 * coordinates (y may be negative: hats rise above the box). Hat canvases carry a 1px outline
 * pad on every side, so the fill is (w-2)x(h-2) and its bottom row sits on the anchor row.
 * The hat is centred on the anchor column, then nudged sideways just enough to stay inside
 * the 16px column (a small side-view head near the box edge, like the turtle's, would
 * otherwise push a wide brim off the composite canvas).
 */
export function hatPlacement(animal: AnimalId, facing: Facing, frame: number, canvasW: number, canvasH: number): { x: number; y: number } {
  const [cx, bottom] = ANIMAL_ART[animal].hat[baseFacing(facing)];
  const fillW = canvasW - 2;
  const fillH = canvasH - 2;
  const left = cx - Math.floor(fillW / 2);
  const fillX = facing === 'right' ? ANIMAL_SIZE - left - fillW : left;
  const x = Math.max(0, Math.min(ANIMAL_SIZE - canvasW, fillX - 1));
  return { x, y: bottom - fillH + 1 - frameBob(frame) - 1 };
}
