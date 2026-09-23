// Grid geometry helpers. Tiles are addressed by integer (x, y); positions inside the arena are
// integer sub-units (CONFIG.SUB per tile). Arrays over the grid are row-major: i = y * w + x.
import { CONFIG } from './config';
import { Dir, type DirCode } from './types';

/** Row-major index of tile (x, y) in a grid of width w. */
export function idx(w: number, x: number, y: number): number {
  return y * w + x;
}

/** Tile coordinate containing a sub-unit coordinate. */
export function tileOf(sub: number): number {
  return Math.floor(sub / CONFIG.SUB);
}

/** Sub-unit coordinate of the center of tile coordinate t. */
export function tileCenter(t: number): number {
  return t * CONFIG.SUB + CONFIG.SUB / 2;
}

/** Tile step in x per DirCode (index 0 = Dir.None). */
export const DIR_DX: readonly number[] = [0, 0, 0, -1, 1];
/** Tile step in y per DirCode (index 0 = Dir.None). */
export const DIR_DY: readonly number[] = [0, -1, 1, 0, 0];

/** The four movement directions in splash-arm order: [Up, Down, Left, Right]. */
export const ALL_DIRS: readonly DirCode[] = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

/** Distance of a tile from the arena edge: 0 = border ring, 1 = first walkable ring, ... */
export function ringIndex(w: number, h: number, x: number, y: number): number {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}
