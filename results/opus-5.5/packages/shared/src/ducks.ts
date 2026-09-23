// Revenge ducks: soaked players ride a rubber duck along the border loop and lob balloons
// straight inward. The loop runs clockwise from the top-left border tile (0,0): top edge
// left->right, right edge top->bottom, bottom edge right->left, left edge bottom->top.
// Loop positions are sub-units along that path; tile k's center sits at pos = k * SUB.
import { CONFIG } from './config';
import { DIR_DX, DIR_DY, idx, inBounds, tileCenter, tileOf } from './grid';
import { balloonAt, spawnBalloon } from './state';
import { isFlooded } from './tide';
import { Dir, Tile, type DirCode, type GameEvent, type PlayerInput, type PlayerState, type RoundState } from './types';

/** DUCK_SPEED tiles/s along the loop = 600 sub-units per tick. */
const DUCK_UNITS_PER_TICK = Math.round((CONFIG.DUCK_SPEED * CONFIG.SUB) / CONFIG.TICK_RATE);

/** Inward lob step per side: 0 top -> down, 1 right -> left, 2 bottom -> up, 3 left -> right. */
const INWARD: readonly (readonly [number, number])[] = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

function loopTileCount(w: number, h: number): number {
  return 2 * (w - 1) + 2 * (h - 1);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Length of the border loop in sub-units. */
export function borderLoopLength(w: number, h: number): number {
  return loopTileCount(w, h) * CONFIG.SUB;
}

/** Border tile at loop index k (wraps). */
function loopTileAt(w: number, h: number, k: number): { tx: number; ty: number } {
  let i = mod(k, loopTileCount(w, h));
  if (i < w - 1) return { tx: i, ty: 0 };
  i -= w - 1;
  if (i < h - 1) return { tx: w - 1, ty: i };
  i -= h - 1;
  if (i < w - 1) return { tx: w - 1 - i, ty: h - 1 };
  i -= w - 1;
  return { tx: 0, ty: h - 1 - i };
}

/** Loop index of a border tile. */
function loopIndexOf(w: number, h: number, tx: number, ty: number): number {
  if (ty === 0) return tx;
  if (tx === w - 1) return w - 1 + ty;
  if (ty === h - 1) return 2 * (w - 1) + (h - 1) - tx;
  return 2 * (w - 1) + 2 * (h - 1) - ty;
}

function sideOf(w: number, h: number, tx: number, ty: number): number {
  const horizontalEdge = ty === 0 || ty === h - 1;
  const verticalEdge = tx === 0 || tx === w - 1;
  if (horizontalEdge && verticalEdge) return -1;
  if (ty === 0) return 0;
  if (tx === w - 1) return 1;
  if (ty === h - 1) return 2;
  return 3;
}

/** Border tile nearest to a loop position; side 0 top, 1 right, 2 bottom, 3 left, -1 corner. */
export function duckTile(w: number, h: number, pos: number): { tx: number; ty: number; side: number } {
  const k = Math.floor((mod(pos, borderLoopLength(w, h)) + CONFIG.SUB / 2) / CONFIG.SUB);
  const { tx, ty } = loopTileAt(w, h, k);
  return { tx, ty, side: sideOf(w, h, tx, ty) };
}

/** Sub-unit position of a loop position (interpolated between border tile centers). */
export function duckXY(w: number, h: number, pos: number): { x: number; y: number } {
  const p = mod(pos, borderLoopLength(w, h));
  const k = Math.floor(p / CONFIG.SUB);
  const frac = p - k * CONFIG.SUB;
  const a = loopTileAt(w, h, k);
  const b = loopTileAt(w, h, k + 1);
  return { x: tileCenter(a.tx) + (b.tx - a.tx) * frac, y: tileCenter(a.ty) + (b.ty - a.ty) * frac };
}

/** Loop position (a border tile center) nearest to a sub-unit arena position; ties prefer top, right, bottom, left. */
export function nearestDuckPos(w: number, h: number, x: number, y: number): number {
  const tx = Math.min(w - 1, Math.max(0, tileOf(x)));
  const ty = Math.min(h - 1, Math.max(0, tileOf(y)));
  const options = [
    { dist: ty, tx, ty: 0 },
    { dist: w - 1 - tx, tx: w - 1, ty },
    { dist: h - 1 - ty, tx, ty: h - 1 },
    { dist: tx, tx: 0, ty },
  ];
  let best = options[0];
  for (const o of options) if (o.dist < best.dist) best = o;
  return loopIndexOf(w, h, best.tx, best.ty) * CONFIG.SUB;
}

/** True if `dir` points from border tile k to border tile k + step. */
function pointsAlong(w: number, h: number, k: number, step: number, dir: DirCode): boolean {
  const here = loopTileAt(w, h, k);
  const there = loopTileAt(w, h, k + step);
  return DIR_DX[dir] === there.tx - here.tx && DIR_DY[dir] === there.ty - here.ty;
}

/** +1 (clockwise), -1 or 0: which way `dir` moves a duck at `pos` along the loop. */
function loopDirection(w: number, h: number, pos: number, dir: DirCode): number {
  const p = mod(pos, borderLoopLength(w, h));
  const k = Math.floor(p / CONFIG.SUB);
  const atCenter = p === k * CONFIG.SUB;
  if (pointsAlong(w, h, k, 1, dir)) return 1;
  if (atCenter ? pointsAlong(w, h, k, -1, dir) : pointsAlong(w, h, k + 1, -1, dir)) return -1;
  return 0;
}

/** Moves along the loop, stopping at a tile center where the pressed direction no longer applies (corners). */
function moveAlongLoop(w: number, h: number, pos: number, dir: DirCode): number {
  const length = borderLoopLength(w, h);
  let p = pos;
  let budget = DUCK_UNITS_PER_TICK;
  while (budget > 0) {
    const sign = loopDirection(w, h, p, dir);
    if (sign === 0) break;
    const frac = mod(p, CONFIG.SUB);
    const toCenter = sign > 0 ? CONFIG.SUB - frac : frac === 0 ? CONFIG.SUB : frac;
    const step = Math.min(budget, toCenter);
    p = mod(p + sign * step, length);
    budget -= step;
  }
  return p;
}

/**
 * Landing rule: floor, not flooded, not under lingering splash water, no balloon (a lob flies
 * over everything in between). Lingering water is excluded because a balloon landing there
 * would burst in this same tick, turning the lob into a zero-fuse, unreactable splash.
 */
function canLandLob(s: RoundState, x: number, y: number): boolean {
  if (!inBounds(s.w, s.h, x, y)) return false;
  const i = idx(s.w, x, y);
  if (s.tiles[i] !== Tile.Floor || s.splashUntil[i] > s.tick) return false;
  return !isFlooded(s, x, y) && balloonAt(s, x, y) === undefined;
}

/** Lobs straight inward onto the farthest landable tile at DUCK_LOB_DISTANCE..1. */
function tryLob(s: RoundState, p: PlayerState, events: GameEvent[]): void {
  if (s.tick < p.duckCooldownUntil) return;
  const { tx, ty, side } = duckTile(s.w, s.h, p.duckPos);
  if (side < 0) return;
  const [dx, dy] = INWARD[side];
  for (let dist = CONFIG.DUCK_LOB_DISTANCE; dist >= 1; dist--) {
    const lx = tx + dx * dist;
    const ly = ty + dy * dist;
    if (!canLandLob(s, lx, ly)) continue;
    const b = spawnBalloon(s, {
      owner: p.slot,
      tx: lx,
      ty: ly,
      burstTick: s.tick + CONFIG.DUCK_FUSE_TICKS,
      range: CONFIG.DUCK_BALLOON_RANGE,
      fromDuck: true,
    });
    p.duckCooldownUntil = s.tick + CONFIG.DUCK_LOB_COOLDOWN_TICKS;
    events.push({ type: 'revenge_lob', slot: p.slot, id: b.id, fromX: tx, fromY: ty, toX: lx, toY: ly });
    return;
  }
}

/** One tick for a soaked player's duck: move along the border, lob on a balloon press. */
export function stepDuck(s: RoundState, p: PlayerState, input: PlayerInput | null, events: GameEvent[]): void {
  if (p.duckPos < 0) return;
  const before = p.duckPos;
  if (input && input.dir !== Dir.None) {
    p.facing = input.dir;
    p.duckPos = moveAlongLoop(s.w, s.h, p.duckPos, input.dir);
  }
  p.moving = p.duckPos !== before;
  if (input && input.balloon) tryLob(s, p, events);
}
