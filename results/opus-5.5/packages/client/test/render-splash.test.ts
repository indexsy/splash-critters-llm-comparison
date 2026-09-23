// A splashed tile soaks critters and chain-bursts balloons for the whole splash (the sim checks
// splashUntil > tick), so every frame shown during that window must read as solid water.
// Regression: the last quarter used to break up into ~12% scattered specks while still lethal.
import { CONFIG, Dir, type DirCode } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import type { PixelGrid } from '../src/render/pixelart';
import { SPLASH_FRAMES, splashFrameAt, splashGrid, type SplashPart } from '../src/render/sprites-fx';

const MIN_BAND = 5;
const DIRS: readonly DirCode[] = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

/** Length of the opaque run through the tile's two middle pixels along a line, 0 if broken. */
function runThroughMiddle(g: PixelGrid, line: number, vertical: boolean): number {
  const at = (i: number) => (vertical ? g.get(line, i) : g.get(i, line));
  if (!at(7) || !at(8)) return 0;
  let lo = 7;
  let hi = 8;
  while (lo > 0 && at(lo - 1)) lo--;
  while (hi < 15 && at(hi + 1)) hi++;
  return hi - lo + 1;
}

interface BandCheck {
  /** true: check columns (a horizontal band); false: check rows (a vertical band). */
  columns: boolean;
  from: number;
  to: number;
}

/** Lines that must carry solid water for a part: the whole tile, or the half joining the arm. */
function bandChecks(part: SplashPart, dir: DirCode): BandCheck[] {
  const horizontal = dir === Dir.Left || dir === Dir.Right;
  if (part === 'center') {
    return [
      { columns: true, from: 0, to: 15 },
      { columns: false, from: 0, to: 15 },
    ];
  }
  if (part === 'arm') return [{ columns: horizontal, from: 0, to: 15 }];
  const armSide: Record<number, [number, number]> = {
    [Dir.Right]: [0, 8],
    [Dir.Left]: [7, 15],
    [Dir.Down]: [0, 8],
    [Dir.Up]: [7, 15],
  };
  const [from, to] = armSide[dir];
  return [{ columns: horizontal, from, to }];
}

function opaque(g: PixelGrid): number {
  return g.px.filter(Boolean).length;
}

const PARTS: readonly SplashPart[] = ['center', 'arm', 'end'];

describe('splash tiles during the lethal window', () => {
  it('every frame keeps a solid band through the middle of the tile', () => {
    const broken: string[] = [];
    for (const colorblind of [false, true]) {
      for (const part of PARTS) {
        for (const dir of DIRS) {
          for (let frame = 0; frame < SPLASH_FRAMES; frame++) {
            const g = splashGrid(part, dir, frame, colorblind);
            for (const check of bandChecks(part, dir)) {
              for (let line = check.from; line <= check.to; line++) {
                const run = runThroughMiddle(g, line, check.columns);
                if (run < MIN_BAND) broken.push(`${part}/dir${dir}/f${frame}/cb${colorblind ? 1 : 0} line ${line}: run ${run}`);
              }
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('the last lethal frame keeps most of the water (no speck-only fade)', () => {
    for (const part of PARTS) {
      const burst = opaque(splashGrid(part, Dir.Right, 0, false));
      const last = opaque(splashGrid(part, Dir.Right, SPLASH_FRAMES - 1, false));
      expect(last / burst, part).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('maps every lethal tick to a frame and ends on the last one', () => {
    const frames = Array.from({ length: CONFIG.SPLASH_TICKS }, (_, elapsed) => splashFrameAt(elapsed, CONFIG.SPLASH_TICKS));
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(SPLASH_FRAMES - 1);
    expect(frames.every((f, i) => i === 0 || f >= frames[i - 1])).toBe(true);
  });
});
