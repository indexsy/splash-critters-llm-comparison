// Soak animations (critter hit by a splash, squashes and melts into a wet puddle; the cat
// puffs up first and sulks under a rain cloud at the end) and the revenge rubber-duck ride.
import type { AnimalId, HatId } from '@splash/shared';
import { PAL, splashPalette, type SplashPalette } from './palette';
import { PixelGrid, cached } from './pixelart';
import { ANIMAL_ART, animalFill } from './sprites-animals';
import { critterGrid, CRITTER_OY } from './sprites-critter';

/** Soak frames are SOAK_W x SOAK_H; the critter's 16x16 box sits at (SOAK_OX, SOAK_OY). */
export const SOAK_W = 24;
export const SOAK_H = 24;
export const SOAK_OX = 4;
export const SOAK_OY = 8;
/** Suggested display time per soak frame; the last frame is the resting "soaked" pose. */
export const SOAK_FRAME_MS = 110;

/** Number of soak frames; the cat gets its extra-dramatic sequence. */
export function soakFrameCount(animal: AnimalId): number {
  return animal === 'cat' ? 9 : 6;
}

const FLOOR_Y = SOAK_OY + 15;
const CX = SOAK_OX + 7.5;

/** Diagonal "wet sheen" streaks over the opaque pixels of a fill grid. */
function wet(g: PixelGrid, pal: SplashPalette): PixelGrid {
  const out = g.clone();
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.get(x, y) && (x + 2 * y) % 5 === 0) out.set(x, y, pal.light);
  return out;
}

/** Squash the critter fill (bottom-anchored on the floor line) by the given factors. */
function squashed(fill: PixelGrid, sx: number, sy: number): { grid: PixelGrid; x: number; y: number } {
  const b = fill.bounds() ?? { x: 0, y: 0, w: fill.w, h: fill.h };
  const w = Math.max(2, Math.round(b.w * sx));
  const h = Math.max(2, Math.round(b.h * sy));
  const grid = fill.crop(b.x, b.y, b.w, b.h).resized(w, h);
  return { grid, x: Math.round(CX - w / 2 + 0.5), y: FLOOR_Y - h };
}

function puddle(g: PixelGrid, rx: number, ry: number, pal: SplashPalette): void {
  const cy = FLOOR_Y - ry + 0.5;
  g.ellipse(CX, cy, rx + 1, ry + 1, pal.edge);
  g.ellipse(CX, cy, rx, ry, pal.body);
  g.ellipse(CX - rx / 3, cy - ry / 3, rx / 3, Math.max(0.5, ry / 3), pal.light);
}

/** Water fountain bursting over the critter's head (size 0..2): a dome plus fanned jets. */
function splashCrown(g: PixelGrid, top: number, size: number, pal: SplashPalette): void {
  for (let i = -2; i <= 2; i++) {
    const len = 3 + size + (i === 0 ? 1 : Math.abs(i) === 1 ? 2 : 0);
    let x = 0;
    let y = 0;
    for (let step = 0; step <= len; step++) {
      x = Math.round(CX + i * 2 + i * 0.6 * step);
      y = top - step;
      g.set(x, y, pal.body).set(x + 1, y, step < len - 1 ? pal.light : pal.body);
    }
    g.set(x, y - 1, pal.core);
    g.set(Math.round(x + i * 0.8), y - 3, pal.light);
  }
  g.ellipse(CX, top + 1, 6 + size, 2, pal.edge);
  g.ellipse(CX, top + 1, 5 + size, 1.2, pal.body);
  g.hline(Math.round(CX - 3 - size), Math.round(CX + 2 + size), top, pal.core);
}

function droplets(g: PixelGrid, spots: readonly (readonly [number, number])[], pal: SplashPalette): void {
  spots.forEach(([x, y], i) => {
    g.set(x, y, i % 2 === 0 ? pal.body : pal.light);
    if (i % 3 === 0) g.set(x, y + 1, pal.body);
  });
}

const SPRAY_NEAR: readonly (readonly [number, number])[] = [[2, 6], [21, 6], [1, 10], [22, 11], [4, 3], [19, 2]];
const SPRAY_FAR: readonly (readonly [number, number])[] = [[0, 4], [23, 3], [1, 14], [22, 15], [6, 0], [17, 0]];
const DRIPS: readonly (readonly [number, number])[] = [[3, 16], [20, 15], [5, 12], [18, 11]];

/** Ink-outline a fill grid onto the frame. */
function stamp(frame: PixelGrid, fill: PixelGrid, x: number, y: number): void {
  const pad = new PixelGrid(fill.w + 2, fill.h + 2).blit(fill, 1, 1).outlined(PAL.ink);
  frame.blit(pad, x - 1, y - 1);
}

/** Final puddle pose: a flat blob in the animal's colours with little eyes. */
function blob(g: PixelGrid, animal: AnimalId, pal: SplashPalette, eyes: 'open' | 'closed' | 'grumpy'): void {
  const colors = ANIMAL_ART[animal].colors;
  const cy = FLOOR_Y - 3;
  const body = new PixelGrid(SOAK_W, SOAK_H).ellipse(CX, cy, 6, 2.5, colors.a).ellipse(CX + 3, cy - 1, 1.5, 0.4, pal.light);
  stamp(g, body, 0, 0);
  const ey = cy;
  const [lx, rx] = [Math.round(CX - 3), Math.round(CX + 2)];
  if (eyes === 'closed') {
    g.hline(lx - 1, lx, ey, PAL.ink).hline(rx, rx + 1, ey, PAL.ink);
  } else {
    g.set(lx, ey, PAL.ink).set(lx, ey - 1, PAL.white).set(rx, ey, PAL.ink).set(rx, ey - 1, PAL.white);
    if (eyes === 'grumpy') g.set(lx - 1, ey - 2, PAL.ink).set(lx, ey - 2, PAL.ink).set(rx, ey - 2, PAL.ink).set(rx + 1, ey - 2, PAL.ink);
  }
}

type SoakStep = (g: PixelGrid, fill: PixelGrid, animal: AnimalId, pal: SplashPalette) => void;

/** The shared six-step soak: hit, drench, squash, melt, puddle, rest. */
const SOAK_STEPS: readonly SoakStep[] = [
  (g, fill, _a, pal) => {
    stamp(g, fill, SOAK_OX, SOAK_OY);
    splashCrown(g, SOAK_OY + 2, 2, pal);
    droplets(g, SPRAY_NEAR, pal);
  },
  (g, fill, _a, pal) => {
    const s = squashed(wet(fill, pal), 1.1, 0.88);
    puddle(g, 7, 1, pal);
    stamp(g, s.grid, s.x, s.y);
    splashCrown(g, s.y + 1, 0, pal);
    droplets(g, SPRAY_FAR, pal);
  },
  (g, fill, _a, pal) => {
    puddle(g, 9, 2, pal);
    const s = squashed(wet(fill, pal), 1.2, 0.66);
    stamp(g, s.grid, s.x, s.y);
    droplets(g, DRIPS, pal);
  },
  (g, fill, _a, pal) => {
    puddle(g, 10, 2, pal);
    const s = squashed(wet(fill, pal), 1.25, 0.4);
    stamp(g, s.grid, s.x, s.y);
    droplets(g, DRIPS.slice(0, 2), pal);
  },
  (g, _f, animal, pal) => {
    puddle(g, 10, 3, pal);
    blob(g, animal, pal, 'open');
  },
  (g, _f, animal, pal) => {
    puddle(g, 10, 3, pal);
    blob(g, animal, pal, 'closed');
  },
];

/**
 * Spiky fur puff: grow the silhouette by `layers` jagged rings of fur. The result is padded
 * by `layers` pixels on every side (stamp it `layers` up-left of the original position).
 */
function puffed(fill: PixelGrid, layers: number, fur: string): PixelGrid {
  let g = new PixelGrid(fill.w + layers * 2, fill.h + layers * 2).blit(fill, layers, layers);
  for (let i = 0; i < layers; i++) {
    const grown = g.outlined(fur, true);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (!g.get(x, y) && (x + y + i) % 2 === 1) grown.set(x, y, null);
    g = grown;
  }
  return g;
}

function exclaim(g: PixelGrid, x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const ex = x + i * 3;
    const mark = new PixelGrid(1, 5).vline(0, 0, 2, PAL.white).set(0, 4, PAL.white);
    stamp(g, mark, ex, y);
  }
}

function rainCloud(g: PixelGrid, pal: SplashPalette): void {
  const cloud = new PixelGrid(SOAK_W, 8).ellipse(9, 3, 3, 2, PAL.greyDark).ellipse(13, 2.5, 3.5, 2.5, PAL.greyDark).ellipse(12, 2, 2, 1, PAL.grey);
  stamp(g, cloud, 0, 5);
  [[9, 12], [12, 14], [15, 12], [14, 15], [10, 15]].forEach(([x, y]) => g.set(x, y, pal.body));
}

/** Extra-dramatic cat prologue (fur puff, bigger puff, hit) and epilogue (sulk cloud). */
const CAT_INTRO: readonly SoakStep[] = [
  (g, fill, animal) => {
    stamp(g, puffed(fill, 1, ANIMAL_ART[animal].colors.a), SOAK_OX - 1, SOAK_OY - 1);
    exclaim(g, SOAK_OX + 13, SOAK_OY - 3, 1);
  },
  (g, fill, animal) => {
    const big = puffed(fill, 2, ANIMAL_ART[animal].colors.a);
    stamp(g, big, SOAK_OX - 2, SOAK_OY - 4);
    exclaim(g, SOAK_OX + 12, SOAK_OY - 6, 2);
  },
  (g, fill, animal, pal) => {
    stamp(g, puffed(fill, 2, ANIMAL_ART[animal].colors.a), SOAK_OX - 2, SOAK_OY - 2);
    splashCrown(g, SOAK_OY + 1, 2, pal);
    droplets(g, SPRAY_FAR, pal);
  },
];

const CAT_OUTRO: SoakStep = (g, _f, animal, pal) => {
  puddle(g, 10, 3, pal);
  blob(g, animal, pal, 'grumpy');
  rainCloud(g, pal);
};

function soakSteps(animal: AnimalId): readonly SoakStep[] {
  return animal === 'cat' ? [...CAT_INTRO, ...SOAK_STEPS.slice(1), CAT_OUTRO] : SOAK_STEPS;
}

/** Cached soak frame (clamped to the last, resting frame). */
export function getSoakFrame(animal: AnimalId, frame: number, slot: number, colorblind = false): HTMLCanvasElement {
  const steps = soakSteps(animal);
  const f = Math.max(0, Math.min(steps.length - 1, frame));
  return cached(`soak:${animal}:${f}:${slot}:${colorblind ? 1 : 0}`, () => {
    const g = new PixelGrid(SOAK_W, SOAK_H);
    steps[f](g, animalFill(animal, 'down', 0, slot, colorblind), animal, splashPalette(colorblind));
    return g.toCanvas();
  });
}

// ---------------------------------------------------------------------------------------
// Revenge rubber-duck ride
// ---------------------------------------------------------------------------------------

export const DUCK_RIDE_W = 24;
export const DUCK_RIDE_H = 26;
/** Pixel of the ride canvas that sits on the duck's world position (tile centre). */
export const DUCK_RIDE_ANCHOR = { x: 12, y: 19 } as const;
export const DUCK_RIDE_FRAMES = 2;

function rubberDuck(): PixelGrid {
  const g = new PixelGrid(DUCK_RIDE_W, 10);
  g.ellipse(11, 5, 9, 3.5, PAL.yellow);
  g.ellipse(11, 7, 8, 1.5, PAL.gold);
  g.ellipse(14, 4, 3, 1, PAL.gold);
  g.set(20, 2, PAL.yellow).set(20, 3, PAL.yellow).set(21, 2, PAL.yellow);
  g.ellipse(9, 3, 3, 1, PAL.yellowLight);
  return g;
}

function duckHead(): PixelGrid {
  const g = new PixelGrid(9, 8);
  g.ellipse(4.5, 3.5, 3.5, 3.5, PAL.yellow);
  g.ellipse(3.5, 2.5, 1.5, 1, PAL.yellowLight);
  g.rect(0, 4, 2, 2, PAL.orange).set(0, 5, PAL.orangeDark);
  g.set(3, 3, PAL.ink);
  return g;
}

function ripple(g: PixelGrid, frame: number, pal: SplashPalette): void {
  for (let x = 1; x < DUCK_RIDE_W - 2; x++) {
    const up = (x + frame * 2) % 4 < 2;
    g.set(x, DUCK_RIDE_H - 2 + (up ? 0 : 1), x % 3 === 0 ? pal.core : pal.light);
  }
}

/** Cached revenge-duck ride: the soaked critter (+hat) riding a rubber duck, 2 bob frames. */
export function getDuckRide(animal: AnimalId, frame: number, slot: number, colorblind = false, hat: HatId = 'none'): HTMLCanvasElement {
  const f = ((frame % DUCK_RIDE_FRAMES) + DUCK_RIDE_FRAMES) % DUCK_RIDE_FRAMES;
  return cached(`ride:${animal}:${hat}:${f}:${slot}:${colorblind ? 1 : 0}`, () => {
    const g = new PixelGrid(DUCK_RIDE_W, DUCK_RIDE_H);
    ripple(g, f, splashPalette(colorblind));
    const rider = critterGrid(animal, hat, 'down', 0, slot, colorblind, 0).crop(0, 0, 16, CRITTER_OY + 13);
    g.blit(rider, 8, f);
    stamp(g, rubberDuck(), 0, 14 + f);
    stamp(g, duckHead(), 1, 9 + f);
    return g.toCanvas();
  });
}
