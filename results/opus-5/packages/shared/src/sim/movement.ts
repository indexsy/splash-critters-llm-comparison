/**
 * Grid movement with auto-centring.
 *
 * A critter is an axis-aligned box of half-width PLAYER_RADIUS. Moving along
 * one axis pulls it toward the centre of its lane on the other axis, which is
 * what makes corridors enterable and corners roundable without the player
 * having to be pixel-perfect. Pure arithmetic - identical on server and client.
 */

import { CONFIG } from '../config.js';
import { Dir, type DirValue } from '../types.js';
import type { SolidFn } from './state.js';

const R = CONFIG.PLAYER_RADIUS;
const EPS = CONFIG.COLLISION_EPSILON;

export interface MoveResult {
  moved: boolean;
  /** True when the advance was cut short by something solid. */
  blocked: boolean;
  /** The tile that stopped us (only meaningful when `blocked`). */
  blockedX: number;
  blockedY: number;
}

const NO_MOVE: MoveResult = { moved: false, blocked: false, blockedX: 0, blockedY: 0 };

export interface Movable {
  x: number;
  y: number;
}

/** Does the box centred on (x, y) overlap any solid tile? */
export function boxBlocked(solid: SolidFn, x: number, y: number): boolean {
  const x0 = Math.floor(x - R);
  const x1 = Math.floor(x + R);
  const y0 = Math.floor(y - R);
  const y1 = Math.floor(y + R);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (solid(tx, ty)) return true;
    }
  }
  return false;
}

function columnSolid(solid: SolidFn, tx: number, y0: number, y1: number): boolean {
  for (let ty = y0; ty <= y1; ty++) if (solid(tx, ty)) return true;
  return false;
}

function rowSolid(solid: SolidFn, ty: number, x0: number, x1: number): boolean {
  for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
  return false;
}

/**
 * Advance `p` by `dist` tiles in `dir`, stopping flush against the first solid
 * tile in the way. Returns whether it moved and what blocked it.
 */
export function stepEntity(solid: SolidFn, p: Movable, dir: DirValue, dist: number): MoveResult {
  if (dir === Dir.NONE || dist <= 0) return { ...NO_MOVE };

  const horizontal = dir === Dir.LEFT || dir === Dir.RIGHT;
  const startX = p.x;
  const startY = p.y;

  // 1. Auto-centre on the perpendicular axis.
  if (horizontal) {
    const lane = Math.floor(p.y) + 0.5;
    const diff = lane - p.y;
    if (diff !== 0) {
      const step = Math.abs(diff) <= dist ? diff : (diff < 0 ? -dist : dist);
      if (!boxBlocked(solid, p.x, p.y + step)) p.y += step;
    }
  } else {
    const lane = Math.floor(p.x) + 0.5;
    const diff = lane - p.x;
    if (diff !== 0) {
      const step = Math.abs(diff) <= dist ? diff : (diff < 0 ? -dist : dist);
      if (!boxBlocked(solid, p.x + step, p.y)) p.x += step;
    }
  }

  // 2. Advance along the movement axis.
  let blocked = false;
  let blockedX = 0;
  let blockedY = 0;

  if (dir === Dir.RIGHT) {
    const target = p.x + dist;
    const y0 = Math.floor(p.y - R);
    const y1 = Math.floor(p.y + R);
    const from = Math.floor(p.x + R);
    const to = Math.floor(target + R);
    let limit = target;
    // A leading edge sitting exactly on a boundary is not inside that tile yet,
    // so the scan has to include it rather than start one tile past it.
    for (let tx = p.x + R === from ? from : from + 1; tx <= to; tx++) {
      if (columnSolid(solid, tx, y0, y1)) {
        limit = tx - R - EPS;
        blocked = true;
        blockedX = tx;
        blockedY = Math.floor(p.y);
        break;
      }
    }
    p.x = Math.max(p.x, Math.min(target, limit));
  } else if (dir === Dir.LEFT) {
    const target = p.x - dist;
    const y0 = Math.floor(p.y - R);
    const y1 = Math.floor(p.y + R);
    const from = Math.floor(p.x - R);
    const to = Math.floor(target - R);
    let limit = target;
    for (let tx = from - 1; tx >= to; tx--) {
      if (columnSolid(solid, tx, y0, y1)) {
        limit = tx + 1 + R + EPS;
        blocked = true;
        blockedX = tx;
        blockedY = Math.floor(p.y);
        break;
      }
    }
    p.x = Math.min(p.x, Math.max(target, limit));
  } else if (dir === Dir.DOWN) {
    const target = p.y + dist;
    const x0 = Math.floor(p.x - R);
    const x1 = Math.floor(p.x + R);
    const from = Math.floor(p.y + R);
    const to = Math.floor(target + R);
    let limit = target;
    // Same boundary case as Dir.RIGHT, one axis over.
    for (let ty = p.y + R === from ? from : from + 1; ty <= to; ty++) {
      if (rowSolid(solid, ty, x0, x1)) {
        limit = ty - R - EPS;
        blocked = true;
        blockedX = Math.floor(p.x);
        blockedY = ty;
        break;
      }
    }
    p.y = Math.max(p.y, Math.min(target, limit));
  } else if (dir === Dir.UP) {
    const target = p.y - dist;
    const x0 = Math.floor(p.x - R);
    const x1 = Math.floor(p.x + R);
    const from = Math.floor(p.y - R);
    const to = Math.floor(target - R);
    let limit = target;
    for (let ty = from - 1; ty >= to; ty--) {
      if (rowSolid(solid, ty, x0, x1)) {
        limit = ty + 1 + R + EPS;
        blocked = true;
        blockedX = Math.floor(p.x);
        blockedY = ty;
        break;
      }
    }
    p.y = Math.min(p.y, Math.max(target, limit));
  }

  const moved = p.x !== startX || p.y !== startY;
  return { moved, blocked, blockedX, blockedY };
}

/** Tiles travelled in one tick at `speed` tiles/second. */
export function distPerTick(speed: number): number {
  return speed / CONFIG.TICK_RATE;
}
