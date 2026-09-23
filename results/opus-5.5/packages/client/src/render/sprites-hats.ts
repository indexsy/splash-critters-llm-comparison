// Hat sprites drawn on top of critters, per facing ('right' mirrors 'left').
// Each hat canvas has a 1px ink outline pad; placement on a critter comes from
// hatPlacement() in sprites-animals.ts. The propeller cap has 2 spin frames.
import type { HatId } from '@splash/shared';
import { PAL } from './palette';
import { PixelGrid, cached, type Legend } from './pixelart';
import { baseFacing, type BaseFacing, type Facing } from './sprites-animals';

interface HatArt {
  legend: Legend;
  /** Frames per base facing; every frame of a facing has the same size. */
  frames: Record<BaseFacing, readonly (readonly string[])[]>;
}

const BUCKET_ROWS = ['..tttttt..', '.tttttttt.', '.bbbbbbbb.', 'llllllllll'];

const CROWN_ROWS = ['y..y..y', 'yyyyyyy', 'ywyryyy', 'ggggggg'];

const PROPELLER_BASE = ['...k...', '.ryyyb.', 'rryyybb'];
const PROPELLER_FRAMES = [['rrrkbbb', ...PROPELLER_BASE], ['..rkb..', ...PROPELLER_BASE]];

const HATS: Record<Exclude<HatId, 'none'>, HatArt> = {
  bucket: {
    legend: { t: PAL.tan, b: PAL.brown, l: PAL.brownLight },
    frames: { down: [BUCKET_ROWS], up: [BUCKET_ROWS], left: [BUCKET_ROWS] },
  },
  snorkel: {
    legend: { r: PAL.pink, g: PAL.skyLight, w: PAL.white, k: PAL.shadow, y: PAL.yellow, o: PAL.orange },
    frames: {
      down: [['.........oo', '.........y.', '.rrrrrrr.y.', 'krgggwggrky', '.rrrrrrr...']],
      up: [['oo.........', '.y.........', '.y.........', 'kykkkkkkkkk']],
      left: [['........oo', '........y.', '.rrr....y.', 'rggrkkkkyk', '.rrr......']],
    },
  },
  crown: {
    legend: { y: PAL.yellow, g: PAL.gold, r: PAL.red, w: PAL.white },
    frames: { down: [CROWN_ROWS], up: [CROWN_ROWS], left: [CROWN_ROWS] },
  },
  bandana: {
    legend: { r: PAL.red, h: PAL.pink, w: PAL.white, R: PAL.redDark },
    frames: {
      down: [['.rrhhrrrr...', 'rrwrrrrwrrRR', 'RRRRRRRRRR.R']],
      up: [['.rrhhrrrr.', 'rrrrwrrrrr', 'RRRRRRRRRR', '...R..R...', '..R....R..']],
      left: [['.rhhrrrrr..', 'rrrrwrrrrRR', 'RRRRRRRRRR.R']],
    },
  },
  propeller: {
    legend: { r: PAL.red, y: PAL.yellow, b: PAL.blue, k: PAL.ink },
    frames: { down: PROPELLER_FRAMES, up: PROPELLER_FRAMES, left: PROPELLER_FRAMES },
  },
};

/** Number of animation frames of a hat (the propeller cap spins while its wearer runs). */
export function hatFrameCount(hat: HatId): number {
  return hat === 'none' ? 1 : HATS[hat].frames.down.length;
}

/** Hat pixel grid with outline pad, or null for 'none'. */
export function hatGrid(hat: HatId, facing: Facing, frame: number): PixelGrid | null {
  if (hat === 'none') return null;
  const art = HATS[hat];
  const frames = art.frames[baseFacing(facing)];
  const rows = frames[((frame % frames.length) + frames.length) % frames.length];
  const fill = PixelGrid.fromRows(rows, art.legend);
  const padded = new PixelGrid(fill.w + 2, fill.h + 2).blit(fill, 1, 1).outlined(PAL.ink);
  return facing === 'right' ? padded.flipX() : padded;
}

/** Cached hat canvas (null for 'none'). Place it with hatPlacement(). */
export function getHat(hat: HatId, facing: Facing, frame: number): HTMLCanvasElement | null {
  if (hat === 'none') return null;
  const f = frame % hatFrameCount(hat);
  return cached(`hat:${hat}:${facing}:${f}`, () => (hatGrid(hat, facing, f) as PixelGrid).toCanvas());
}
