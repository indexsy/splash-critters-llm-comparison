// Revenge-duck riding for soaked bots (casual rules only): pick a border tile whose straight
// inward lob would splash an opponent, paddle there along the border loop and, once the lob
// cooldown is over, lob now and then. Mirrors the sim's landing rule to aim.
import {
  CONFIG,
  Dir,
  Tile,
  balloonAt,
  borderLoopLength,
  computeArms,
  duckTile,
  idx,
  inBounds,
  isFlooded,
  splashTiles,
  tileOf,
  type Difficulty,
  type DirCode,
  type PlayerState,
  type RoundState,
} from '@splash/shared';

/** Inward lob step per border side: 0 top, 1 right, 2 bottom, 3 left. */
const INWARD: readonly (readonly [number, number])[] = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

/** Chance to take a lob when lined up with a target and the cooldown is over (per decision). */
const LOB_CHANCE: Record<Difficulty, number> = { easy: 0.3, medium: 0.5, hard: 0.75 };

export interface DuckAction {
  dir: DirCode;
  lob: boolean;
}

export function loopTiles(s: RoundState): number {
  return borderLoopLength(s.w, s.h) / CONFIG.SUB;
}

/** Where a lob thrown from loop tile k during the next tick would land (-1 if nowhere). */
export function lobLanding(s: RoundState, k: number): number {
  const { tx, ty, side } = duckTile(s.w, s.h, k * CONFIG.SUB);
  if (side < 0) return -1;
  const [dx, dy] = INWARD[side];
  for (let dist = CONFIG.DUCK_LOB_DISTANCE; dist >= 1; dist--) {
    const x = tx + dx * dist;
    const y = ty + dy * dist;
    if (!inBounds(s.w, s.h, x, y)) continue;
    const i = idx(s.w, x, y);
    if (s.tiles[i] !== Tile.Floor || s.splashUntil[i] > s.tick + 1) continue;
    if (isFlooded(s, x, y) || balloonAt(s, x, y) !== undefined) continue;
    return i;
  }
  return -1;
}

/** Loop tiles whose lob would splash the tile of some alive opponent. */
function lobSpots(s: RoundState, me: PlayerState): Set<number> {
  const targets = new Set<number>();
  for (const p of s.players) {
    if (p.present && p.alive && p.slot !== me.slot) targets.add(idx(s.w, tileOf(p.x), tileOf(p.y)));
  }
  const spots = new Set<number>();
  if (targets.size === 0) return spots;
  const n = loopTiles(s);
  for (let k = 0; k < n; k++) {
    const land = lobLanding(s, k);
    if (land < 0) continue;
    const lx = land % s.w;
    const ly = (land - lx) / s.w;
    const arms = computeArms(s, lx, ly, CONFIG.DUCK_BALLOON_RANGE);
    if (splashTiles(lx, ly, arms).some((t) => targets.has(idx(s.w, t.x, t.y)))) spots.add(k);
  }
  return spots;
}

function dirBetweenTiles(a: { tx: number; ty: number }, b: { tx: number; ty: number }): DirCode {
  if (b.tx > a.tx) return Dir.Right;
  if (b.tx < a.tx) return Dir.Left;
  if (b.ty > a.ty) return Dir.Down;
  if (b.ty < a.ty) return Dir.Up;
  return Dir.None;
}

/** The input that moves a duck at `pos` one way (+1 clockwise, -1 counter-clockwise) along the loop. */
function loopDir(s: RoundState, pos: number, sign: number): DirCode {
  const sub = CONFIG.SUB;
  const k = Math.floor(pos / sub);
  const atCenter = pos === k * sub;
  const tileAt = (i: number) => duckTile(s.w, s.h, i * sub);
  if (sign > 0) return dirBetweenTiles(tileAt(k), tileAt(k + 1));
  return atCenter ? dirBetweenTiles(tileAt(k), tileAt(k - 1)) : dirBetweenTiles(tileAt(k + 1), tileAt(k));
}

/** Decides the duck's input for this tick (`decide` = this is a decision tick for the bot). */
export function duckAction(s: RoundState, me: PlayerState, difficulty: Difficulty, rng: () => number, decide: boolean): DuckAction {
  if (me.duckPos < 0) return { dir: Dir.None, lob: false };
  const length = borderLoopLength(s.w, s.h);
  const spots = lobSpots(s, me);
  if (spots.size === 0) return { dir: Dir.None, lob: false };
  const here = Math.round(me.duckPos / CONFIG.SUB) % loopTiles(s);
  const aligned = me.duckPos % CONFIG.SUB === 0 && spots.has(here);
  if (aligned) {
    const ready = s.tick + 1 >= me.duckCooldownUntil;
    return { dir: Dir.None, lob: ready && decide && rng() < LOB_CHANCE[difficulty] };
  }
  let best = Infinity;
  let sign = 0;
  for (const k of spots) {
    const cw = (((k * CONFIG.SUB - me.duckPos) % length) + length) % length;
    const ccw = (length - cw) % length;
    if (cw < best) {
      best = cw;
      sign = 1;
    }
    if (ccw < best) {
      best = ccw;
      sign = -1;
    }
  }
  return { dir: loopDir(s, me.duckPos, sign), lob: false };
}
