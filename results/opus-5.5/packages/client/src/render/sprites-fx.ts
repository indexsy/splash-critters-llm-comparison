// Water balloons (fuse wobble/inflate, sliding after a kick, revenge-duck variant) and the
// cross-shaped splash parts (centre, arm, end caps) in normal and colourblind palettes.
import { Dir, type DirCode } from '@splash/shared';
import { PAL, slotColor, splashPalette, type SplashPalette } from './palette';
import { PixelGrid, cached } from './pixelart';

// ---------------------------------------------------------------------------------------
// Balloons
// ---------------------------------------------------------------------------------------

/** Balloon frames: 4 inflate stages x 2 wobble phases; stage 3 flashes before bursting. */
export const BALLOON_FRAMES = 8;

/** Frame for a balloon `ticksLeft` ticks from bursting with a fuse of `fuseTicks`. */
export function balloonFrameAt(ticksLeft: number, fuseTicks: number, tick: number): number {
  const progress = 1 - Math.max(0, Math.min(1, ticksLeft / Math.max(1, fuseTicks)));
  const stage = Math.min(3, Math.floor(progress * 4));
  const wobble = Math.floor(tick / (stage === 3 ? 3 : 8 - stage * 2)) % 2;
  return stage * 2 + wobble;
}

interface BalloonLook {
  main: string;
  light: string;
  dark: string;
  knot: string;
}

function balloonLook(slot: number, colorblind: boolean, fromDuck: boolean): BalloonLook {
  const sc = slotColor(slot, colorblind);
  return fromDuck
    ? { main: PAL.yellow, light: PAL.yellowLight, dark: PAL.gold, knot: sc.main }
    : { main: sc.main, light: sc.light, dark: sc.dark, knot: sc.dark };
}

/** Balloon body with the given radii, bottom resting on row 14. */
function balloonBody(rx: number, ry: number, look: BalloonLook, flash: boolean, fromDuck: boolean): PixelGrid {
  const g = new PixelGrid(16, 16);
  const cx = 7.5;
  const cy = 14 - ry;
  const main = flash ? look.light : look.main;
  g.ellipse(cx, cy, rx, ry, look.dark);
  g.ellipse(cx - 0.5, cy - 0.5, rx - 0.6, ry - 0.6, main);
  g.ellipse(cx - rx / 2.4, cy - ry / 2.4, Math.max(0.6, rx / 4), Math.max(0.6, ry / 4), look.light);
  g.set(Math.round(cx - rx / 2), Math.round(cy - ry / 1.8), PAL.white);
  const top = Math.round(cy - ry);
  g.rect(7, top - 1, 2, 1, look.dark);
  g.rect(7, top - 2, 2, 1, look.knot).set(9, top - 3, look.knot);
  if (fromDuck) {
    const by = Math.round(cy);
    g.rect(Math.round(cx - rx) - 1, by, 2, 2, PAL.orange).set(Math.round(cx - rx) - 1, by + 1, PAL.orangeDark);
    g.set(Math.round(cx - rx / 2), by - 2, PAL.ink);
  }
  return g;
}

const STAGE_RADII: readonly [number, number][] = [
  [4.5, 4.5],
  [5, 5],
  [5.5, 5.5],
  [6.2, 5.8],
];

/** Cached 16x16 balloon frame tinted by the owner's slot colour (yellow duck for revenge lobs). */
export function getBalloon(frame: number, slot: number, colorblind: boolean, fromDuck: boolean): HTMLCanvasElement {
  const f = ((frame % BALLOON_FRAMES) + BALLOON_FRAMES) % BALLOON_FRAMES;
  return cached(`balloon:${f}:${slot}:${colorblind ? 1 : 0}:${fromDuck ? 1 : 0}`, () => {
    const stage = f >> 1;
    const wobble = f & 1 ? -0.5 : 0.5;
    const [rx, ry] = STAGE_RADII[stage];
    const look = balloonLook(slot, colorblind, fromDuck);
    return balloonBody(rx + wobble, ry - wobble, look, stage === 3 && (f & 1) === 1, fromDuck).outlined(PAL.ink).toCanvas();
  });
}

/** Cached balloon sliding after a kick: squashed along the motion with speed streaks behind. */
export function getSlidingBalloon(dir: DirCode, slot: number, colorblind: boolean, fromDuck: boolean): HTMLCanvasElement {
  return cached(`balloon-slide:${dir}:${slot}:${colorblind ? 1 : 0}:${fromDuck ? 1 : 0}`, () => {
    const look = balloonLook(slot, colorblind, fromDuck);
    const vertical = dir === Dir.Up || dir === Dir.Down;
    const g = balloonBody(vertical ? 4 : 6, vertical ? 6 : 4, look, false, fromDuck).outlined(PAL.ink);
    const streak = PAL.white;
    const trail: Record<number, [number, number, number, number]> = {
      [Dir.Right]: [0, 9, 1, 0],
      [Dir.Left]: [13, 9, -1, 0],
      [Dir.Down]: [5, 0, 0, 1],
      [Dir.Up]: [5, 15, 0, -1],
    };
    const t = trail[dir];
    if (t) {
      const [x0, y0, dx, dy] = t;
      for (let i = 0; i < 3; i++) {
        const ox = dy !== 0 ? i * 3 : 0;
        const oy = dx !== 0 ? i * 2 - 2 : 0;
        for (let s = 0; s < 2 + (i % 2); s++) g.set(x0 + ox + dx * s, y0 + oy + dy * s, streak);
      }
    }
    return g.toCanvas();
  });
}

// ---------------------------------------------------------------------------------------
// Splash
// ---------------------------------------------------------------------------------------

export type SplashPart = 'center' | 'arm' | 'end';
/** burst -> linger -> linger -> recede (all four are lethal: the tile soaks until endTick) */
export const SPLASH_FRAMES = 4;

/** Frame for a splash `elapsed` ticks after it started, lasting `total` ticks. */
export function splashFrameAt(elapsed: number, total: number): number {
  return Math.max(0, Math.min(SPLASH_FRAMES - 1, Math.floor((elapsed * SPLASH_FRAMES) / Math.max(1, total))));
}

const HALF_THICKNESS = [6, 5, 4, 3] as const;
const MID = 7.5;
/** 16-periodic edge turbulence so arm tiles join seamlessly but never look like sausages. */
const EDGE_NOISE = [0, 1, 1, 0, -1, 0, 1, 1, 0, -1, -1, 0, 1, 0, 0, -1] as const;

function edge(t: number, frame: number, salt: number): number {
  return EDGE_NOISE[(t + frame * 3 + salt) & 15];
}

type Mask = (x: number, y: number) => boolean;

/** Band along one axis: `along` runs with the flow, `across` is the distance axis. */
function band(frame: number, along: (x: number, y: number) => number, across: (x: number, y: number) => number): Mask {
  const h = HALF_THICKNESS[frame];
  return (x, y) => {
    const t = along(x, y);
    const d = across(x, y) - MID;
    return d < 0 ? -d <= h + edge(t, frame, 0) - 0.5 : d <= h + edge(t, frame, 7) - 0.5;
  };
}

const hBand = (f: number): Mask => band(f, (x) => x, (_x, y) => y);
const vBand = (f: number): Mask => band(f, (_x, y) => y, (x) => x);

function disc(cx: number, cy: number, r: number): Mask {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const PART_MASKS: Record<SplashPart, (frame: number) => Mask> = {
  arm: (f) => hBand(f),
  center: (f) => {
    const [h, v, d] = [hBand(f), vBand(f), disc(MID, MID, HALF_THICKNESS[f] + (f === 0 ? 2 : 1))];
    return (x, y) => h(x, y) || v(x, y) || d(x, y);
  },
  end: (f) => {
    const [h, d] = [hBand(f), disc(8, MID, HALF_THICKNESS[f] + (f === 0 ? 1 : 0))];
    return (x, y) => (x <= 8 && h(x, y)) || d(x, y);
  },
};

/**
 * Residue where the water just receded from: sparse specks in the ring between the previous
 * frame's extent and the current band. The band itself stays solid on every frame, because a
 * splashed tile soaks critters (and chain-bursts balloons) until the splash's end tick.
 */
function paintResidue(g: PixelGrid, mask: Mask, receded: Mask, pal: SplashPalette): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (mask(x, y) || !receded(x, y) || ((x + 2 * y) % 5 !== 0 && (3 * x + y) % 7 !== 0)) continue;
      g.set(x, y, (x + y) % 3 === 0 ? pal.edge : pal.light);
    }
  }
}

/** Rasterise a splash mask: rim where the mask meets open air inside the tile, foam specks. */
function paintSplash(mask: Mask, frame: number, part: SplashPart, pal: SplashPalette): PixelGrid {
  const g = new PixelGrid(16, 16);
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x <= 15 && y <= 15 && !mask(x, y);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!mask(x, y)) continue;
      const rim = open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1);
      const nearTop = open(x, y - 2) || open(x - 2, y);
      const foam = frame < 2 && Math.abs(y - MID) < 4 && ((x >> 1) * 5 + y * 3 + frame * 7) % 13 === 0;
      const core = part === 'center' && (x - MID) ** 2 + (y - MID) ** 2 < 9 - frame * 4;
      g.set(x, y, rim ? pal.edge : core || foam ? pal.core : nearTop ? pal.light : pal.body);
    }
  }
  if (part === 'end') endDroplets(g, frame, pal.light, pal.edge);
  if (part === 'arm' && frame > 0) armSpray(g, frame, pal.light);
  return g;
}

function armSpray(g: PixelGrid, frame: number, light: string): void {
  const off = HALF_THICKNESS[frame] + 2;
  [3, 11].forEach((x, i) => {
    g.set(x + frame, Math.round(MID - off) - (i % 2), light);
    g.set(x + 4 - frame, Math.round(MID + off) + (i % 2), light);
  });
}

function endDroplets(g: PixelGrid, frame: number, light: string, edge: string): void {
  const spread = 1 + frame;
  const spots: [number, number][] = [
    [13 + (frame > 1 ? 1 : 0), 7],
    [12, 7 - 2 - spread],
    [12, 8 + 2 + spread],
    [14, 4],
    [14, 11],
  ];
  spots.forEach(([x, y], i) => {
    g.set(x, y, i === 0 ? light : edge);
    if (i === 0 && frame < 2) g.set(x + 1, y, light).set(x, y + 1, edge);
  });
}

/** Rotation (clockwise quarter turns) from the base right-pointing art to `dir`. */
function turnsFor(dir: DirCode): number {
  switch (dir) {
    case Dir.Down:
      return 1;
    case Dir.Left:
      return 2;
    case Dir.Up:
      return 3;
    default:
      return 0;
  }
}

/** Quarter turns of a part: the centre never turns, an arm is only horizontal or vertical. */
function splashTurns(part: SplashPart, dir: DirCode): number {
  if (part === 'center') return 0;
  return part === 'arm' ? turnsFor(dir) % 2 : turnsFor(dir);
}

function clampSplashFrame(frame: number): number {
  return Math.max(0, Math.min(SPLASH_FRAMES - 1, frame));
}

/**
 * Splash tile as a pixel grid (see getSplash). Every frame is lethal in the sim, so every
 * frame keeps a solid rimmed band; the last one is thinner, with specks left where the
 * water receded from. The post-splash breakup is a particle job (splashPalette().droplets).
 */
export function splashGrid(part: SplashPart, dir: DirCode, frame: number, colorblind: boolean): PixelGrid {
  const f = clampSplashFrame(frame);
  const pal = splashPalette(colorblind);
  const mask = PART_MASKS[part](f);
  const g = paintSplash(mask, f, part, pal);
  if (f === SPLASH_FRAMES - 1) paintResidue(g, mask, PART_MASKS[part](f - 1), pal);
  return g.rotate(splashTurns(part, dir));
}

/**
 * Cached 16x16 splash tile. `part`: 'center' (dir ignored), 'arm' (Up/Down = vertical,
 * Left/Right = horizontal) or 'end' (cap at the far end of the arm travelling in `dir`).
 */
export function getSplash(part: SplashPart, dir: DirCode, frame: number, colorblind: boolean): HTMLCanvasElement {
  const f = clampSplashFrame(frame);
  return cached(`splash:${part}:${splashTurns(part, dir)}:${f}:${colorblind ? 1 : 0}`, () =>
    splashGrid(part, dir, f, colorblind).toCanvas(),
  );
}
