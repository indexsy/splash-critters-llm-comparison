// Low-level movement helpers for bots: obstacle grids, the exact next-tick position (the shared
// movePlayer on a scratch copy of the player) and directions between tiles. Bots steer toward
// tile centers one path tile at a time; the sim's lane snapping does the rest.
import {
  CONFIG,
  DIR_DX,
  DIR_DY,
  Dir,
  Tile,
  balloonAt,
  computeArms,
  movePlayer,
  splashTiles,
  speedUnitsPerTick,
  tileCenter,
  tileOf,
  type DirCode,
  type PlayerState,
  type RoundState,
} from '@splash/shared';
import type { Mover } from './pathing';

export function tileIndex(s: RoundState, x: number, y: number): number {
  return tileOf(y) * s.w + tileOf(x);
}

/** Tile index of a player's center. */
export function playerTileIndex(s: RoundState, p: PlayerState): number {
  return tileIndex(s, p.x, p.y);
}

export function moverOf(p: PlayerState): Mover {
  return { x: p.x, y: p.y, speed: speedUnitsPerTick(p.speedUps) };
}

/** A mover standing on the center of a tile (used to evaluate standing somewhere later). */
export function moverAtTile(s: RoundState, tile: number, speed: number): Mover {
  const tx = tile % s.w;
  return { x: tileCenter(tx), y: tileCenter((tile - tx) / s.w), speed };
}

/**
 * Tiles nobody can walk into: boulders, castles and every tile a balloon occupies now or will
 * occupy while sliding (`balloonTiles`), plus any hypothetical extras.
 */
export function buildBlocked(s: RoundState, balloonTiles: readonly number[], extra: readonly number[] = []): Uint8Array {
  const blocked = new Uint8Array(s.w * s.h);
  for (let i = 0; i < blocked.length; i++) {
    const t = s.tiles[i];
    if (t === Tile.Boulder || t === Tile.Castle) blocked[i] = 1;
  }
  for (const i of balloonTiles) blocked[i] = 1;
  for (const i of extra) blocked[i] = 1;
  return blocked;
}

/** In-bounds orthogonal neighbours of a tile index, in [up, down, left, right] order. */
export function neighbours(w: number, h: number, t: number): number[] {
  const x = t % w;
  const out: number[] = [];
  if (t >= w) out.push(t - w);
  if (t + w < w * h) out.push(t + w);
  if (x > 0) out.push(t - 1);
  if (x < w - 1) out.push(t + 1);
  return out;
}

/** Direction from tile a to the orthogonally adjacent tile b (Dir.None if not adjacent). */
export function dirBetween(w: number, a: number, b: number): DirCode {
  const d = b - a;
  if (d === -w) return Dir.Up;
  if (d === w) return Dir.Down;
  if (d === -1) return Dir.Left;
  if (d === 1) return Dir.Right;
  return Dir.None;
}

/**
 * Pressing `dir` could kick a balloon: the player wears Boots and the adjacent tile that way holds
 * a resting balloon it may not walk through (the sim kicks once the player is clamped facing it).
 */
export function wouldKick(s: RoundState, p: PlayerState, dir: DirCode): boolean {
  if (dir === Dir.None || !s.rules.kick || !p.canKick) return false;
  const tx = tileOf(p.x) + DIR_DX[dir];
  const ty = tileOf(p.y) + DIR_DY[dir];
  const b = balloonAt(s, tx, ty);
  return b !== undefined && b.slideDir === Dir.None && (b.passMask & (1 << p.slot)) === 0;
}

/** A kicked balloon may slide onto (x, y): an in-bounds floor tile with no balloon and no player standing on it. */
export function slideTargetFree(s: RoundState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h || s.tiles[y * s.w + x] !== Tile.Floor) return false;
  if (balloonAt(s, x, y) !== undefined) return false;
  return !s.players.some((p) => p.present && p.alive && tileOf(p.x) === x && tileOf(p.y) === y);
}

/** Exactly where the player will be after pressing `dir` for one tick (no kick). */
export function predictStep(s: RoundState, p: PlayerState, dir: DirCode): { x: number; y: number } {
  if (dir === Dir.None) return { x: p.x, y: p.y };
  const probe: PlayerState = { ...p };
  movePlayer(s, probe, dir, false);
  return { x: probe.x, y: probe.y };
}

/** Direction that brings the player onto its tile center (None once within half a step). */
export function centeringDir(p: PlayerState): DirCode {
  const tolerance = speedUnitsPerTick(p.speedUps) / 2;
  const dx = tileCenter(tileOf(p.x)) - p.x;
  const dy = tileCenter(tileOf(p.y)) - p.y;
  if (Math.abs(dx) > tolerance) return dx > 0 ? Dir.Right : Dir.Left;
  if (Math.abs(dy) > tolerance) return dy > 0 ? Dir.Down : Dir.Up;
  return Dir.None;
}

/** Ticks one full tile takes at this speed (rounded up). */
export function stepTicks(speed: number): number {
  return Math.ceil(CONFIG.SUB / speed);
}

/** Tiles a balloon with `range` on `tile` would splash right now (the shared computeArms walk). */
export function splashCross(s: RoundState, tile: number, range: number): number[] {
  const tx = tile % s.w;
  const ty = (tile - tx) / s.w;
  return splashTiles(tx, ty, computeArms(s, tx, ty, range)).map((t) => t.y * s.w + t.x);
}
