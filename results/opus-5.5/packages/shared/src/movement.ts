// Player movement (lane snapping, corner assist, re-centering), balloon kicks and sliding.
// Shared by the server (authority) and the client (prediction), so it is integer-only.
import { CONFIG, speedUnitsPerTick } from './config';
import { DIR_DX, DIR_DY, idx, inBounds, tileCenter, tileOf } from './grid';
import { balloonAt, playerBoxOverlapsTile } from './state';
import { Dir, Tile, type Balloon, type DirCode, type GameEvent, type PlayerState, type RoundState } from './types';

/** Kicked balloon speed: KICK_SPEED tiles/s = 1000 sub-units per tick. */
const SLIDE_UNITS_PER_TICK = Math.round((CONFIG.KICK_SPEED * CONFIG.SUB) / CONFIG.TICK_RATE);

export function playerTile(p: PlayerState): { tx: number; ty: number } {
  return { tx: tileOf(p.x), ty: tileOf(p.y) };
}

/** Out of bounds, boulder, castle, or a balloon this slot may not overlap. Flooded tiles are walkable. */
export function isSolidFor(s: RoundState, slot: number, tx: number, ty: number): boolean {
  if (!inBounds(s.w, s.h, tx, ty)) return true;
  const tile = s.tiles[idx(s.w, tx, ty)];
  if (tile === Tile.Boulder || tile === Tile.Castle) return true;
  const b = balloonAt(s, tx, ty);
  return b !== undefined && (b.passMask & (1 << slot)) === 0;
}

/**
 * Moves an alive player one tick in `dir`. Movement along an axis requires the perpendicular
 * coordinate on a lane center; misalignment is first resolved toward the current lane, the
 * neighbour lane (corner assist) or back to the current lane (re-center). Leftover speed
 * continues along the axis. Returns the id of a balloon kicked this tick (-1 if none).
 */
export function movePlayer(s: RoundState, p: PlayerState, dir: DirCode, allowKick: boolean): { kickedId: number } {
  const x0 = p.x;
  const y0 = p.y;
  let kickedId = -1;
  if (p.alive && dir !== Dir.None) {
    p.facing = dir;
    const vertical = dir === Dir.Up || dir === Dir.Down;
    const leftover = alignToLane(s, p, dir, vertical, speedUnitsPerTick(p.speedUps));
    if (leftover > 0) advanceAlongAxis(s, p, dir, vertical, leftover);
    if (allowKick) kickedId = tryKick(s, p, dir);
  }
  p.moving = p.x !== x0 || p.y !== y0;
  return { kickedId };
}

/** Solidity lookup in lane/axis terms: vertical movement uses lanes = columns, axis = rows. */
function solidAt(s: RoundState, slot: number, vertical: boolean, lane: number, along: number): boolean {
  return vertical ? isSolidFor(s, slot, lane, along) : isSolidFor(s, slot, along, lane);
}

function axisStep(dir: DirCode): number {
  return DIR_DX[dir] + DIR_DY[dir];
}

/** Moves the perpendicular coordinate toward the chosen lane; returns the unspent speed. */
function alignToLane(s: RoundState, p: PlayerState, dir: DirCode, vertical: boolean, budget: number): number {
  const c = vertical ? p.x : p.y;
  const lane = tileOf(c);
  const laneCenter = tileCenter(lane);
  if (c === laneCenter) return budget;
  const d = axisStep(dir);
  const along = tileOf(vertical ? p.y : p.x);
  let target = lane;
  if (solidAt(s, p.slot, vertical, lane, along + d)) {
    const neighbour = lane + (c > laneCenter ? 1 : -1);
    const cornerOpen =
      !solidAt(s, p.slot, vertical, neighbour, along) && !solidAt(s, p.slot, vertical, neighbour, along + d);
    if (cornerOpen) target = neighbour;
  }
  const goal = tileCenter(target);
  const step = Math.min(budget, Math.abs(goal - c));
  const next = c + Math.sign(goal - c) * step;
  if (vertical) p.x = next;
  else p.y = next;
  return budget - step;
}

/** Advances an aligned player; stops at the current tile center when the tile ahead is solid. */
function advanceAlongAxis(s: RoundState, p: PlayerState, dir: DirCode, vertical: boolean, budget: number): void {
  const d = axisStep(dir);
  const lane = tileOf(vertical ? p.x : p.y);
  let a = vertical ? p.y : p.x;
  while (budget > 0) {
    const along = tileOf(a);
    if (solidAt(s, p.slot, vertical, lane, along + d)) {
      const gap = (tileCenter(along) - a) * d;
      if (gap > 0) a += d * Math.min(budget, gap);
      break;
    }
    const step = Math.min(budget, (tileCenter(along + d) - a) * d);
    a += d * step;
    budget -= step;
  }
  if (vertical) p.y = a;
  else p.x = a;
}

/**
 * Kick: pressing into a stationary balloon that blocks this player while clamped in front of it,
 * i.e. on the lane center and at (or, since the clamp never pushes back, already past) the tile
 * center along `dir`. The past-center case covers a balloon that appeared ahead mid-stride.
 */
function tryKick(s: RoundState, p: PlayerState, dir: DirCode): number {
  if (!isClampedFacing(p, dir)) return -1;
  const { tx, ty } = playerTile(p);
  const bx = tx + DIR_DX[dir];
  const by = ty + DIR_DY[dir];
  const b = balloonAt(s, bx, by);
  if (!b || b.slideDir !== Dir.None || (b.passMask & (1 << p.slot)) !== 0) return -1;
  if (!isSlideTargetFree(s, b, bx + DIR_DX[dir], by + DIR_DY[dir])) return -1;
  b.slideDir = dir;
  b.passMask = 0;
  return b.id;
}

/** On the lane center perpendicular to `dir`, and at or past the tile center along it. */
function isClampedFacing(p: PlayerState, dir: DirCode): boolean {
  const vertical = dir === Dir.Up || dir === Dir.Down;
  const lane = vertical ? p.x : p.y;
  const along = vertical ? p.y : p.x;
  if (lane !== tileCenter(tileOf(lane))) return false;
  return (along - tileCenter(tileOf(along))) * axisStep(dir) >= 0;
}

/** A sliding balloon may enter a tile that is in bounds, floor, balloon-free and no alive player's center tile. */
function isSlideTargetFree(s: RoundState, self: Balloon, tx: number, ty: number): boolean {
  if (!inBounds(s.w, s.h, tx, ty) || s.tiles[idx(s.w, tx, ty)] !== Tile.Floor) return false;
  const other = balloonAt(s, tx, ty);
  if (other !== undefined && other !== self) return false;
  for (const p of s.players) {
    if (p.present && p.alive && tileOf(p.x) === tx && tileOf(p.y) === ty) return false;
  }
  return true;
}

/** Clears a slot's walk-off bit once that player's box no longer overlaps the balloon tile. */
export function updatePassMasks(s: RoundState): void {
  for (const b of s.balloons) {
    if (b.passMask === 0) continue;
    let mask = 0;
    for (const p of s.players) {
      const bit = 1 << p.slot;
      if ((b.passMask & bit) !== 0 && p.alive && playerBoxOverlapsTile(p, b.tx, b.ty)) mask |= bit;
    }
    b.passMask = mask;
  }
}

/** Advances every kicked balloon (in id order); emits balloon_stopped when one comes to rest. */
export function slideBalloons(s: RoundState, events: GameEvent[]): void {
  for (const b of s.balloons) {
    if (b.slideDir !== Dir.None) slideOne(s, b, events);
  }
}

function slideOne(s: RoundState, b: Balloon, events: GameEvent[]): void {
  const horizontal = DIR_DX[b.slideDir] !== 0;
  const d = axisStep(b.slideDir);
  let budget = SLIDE_UNITS_PER_TICK;
  while (budget > 0) {
    const pos = horizontal ? b.x : b.y;
    const tile = tileOf(pos);
    const center = tileCenter(tile);
    const ahead = (center - pos) * d;
    let goal = center;
    if (ahead <= 0) {
      const nx = horizontal ? tile + d : b.tx;
      const ny = horizontal ? b.ty : tile + d;
      // Checked at the tile center and again on every step until the balloon crosses into the
      // next tile: a player or balloon that moved into its path mid-slide still stops it (back
      // at the current center). Once it has crossed, that tile is solid to players.
      if (!isSlideTargetFree(s, b, nx, ny)) return stopSliding(b, events);
      goal = tileCenter(tile + d);
    }
    const step = Math.min(budget, Math.abs(goal - pos));
    setSlidePos(b, horizontal, pos + d * step);
    budget -= step;
  }
}

function setSlidePos(b: Balloon, horizontal: boolean, pos: number): void {
  if (horizontal) b.x = pos;
  else b.y = pos;
  b.tx = tileOf(b.x);
  b.ty = tileOf(b.y);
}

function stopSliding(b: Balloon, events: GameEvent[]): void {
  b.slideDir = Dir.None;
  b.x = tileCenter(b.tx);
  b.y = tileCenter(b.ty);
  events.push({ type: 'balloon_stopped', id: b.id, x: b.tx, y: b.ty });
}
