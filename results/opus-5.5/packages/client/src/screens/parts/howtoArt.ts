// Illustrations for How to Play, composed from the real game sprites on small tile scenes:
// a splash washing a sandcastle, a kicked balloon sliding, the rising tide with a revenge duck.
import { Dir, type Theme } from '@splash/shared';
import { ctx2d, makeCanvas } from '../../render/pixelart';
import {
  CRITTER_OY,
  DUCK_RIDE_ANCHOR,
  getBalloon,
  getCritter,
  getDuckRide,
  getShadow,
  getSlidingBalloon,
  getSplash,
} from '../../render/sprites';
import { drawArena, drawWater, getCastleCrumble, getWaterEdge, TILE } from '../../render/tiles';
import { settings } from '../../settings';

interface Scene {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Tile scene from rows of '.' floor / 'C' castle / '#' boulder (outer-ring boulders draw as border). */
function scene(theme: Theme, rows: readonly string[]): Scene {
  const w = rows[0].length;
  const h = rows.length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (tiles[y * w + x] = ch === 'C' ? 2 : ch === '#' ? 1 : 0)));
  const cv = makeCanvas(w * TILE, h * TILE);
  const ctx = ctx2d(cv);
  drawArena(ctx, theme, tiles, w, h, 7);
  return { cv, ctx };
}

function critterAt(ctx: CanvasRenderingContext2D, tx: number, ty: number, dir: typeof Dir.Down | typeof Dir.Right, slot: number, frame = 0): void {
  const cb = settings.get().colorblind;
  const animals = ['frog', 'duck', 'otter', 'cat'] as const;
  ctx.drawImage(getShadow(12), tx * TILE + 2, ty * TILE + 13);
  ctx.drawImage(getCritter(animals[slot % 4], 'none', dir, frame, slot, cb), tx * TILE, ty * TILE - CRITTER_OY);
}

/** A range-2 splash bursting in the middle, washing away the sandcastle at the end of its arm. */
export function burstArt(): HTMLCanvasElement {
  const cb = settings.get().colorblind;
  const { cv, ctx } = scene('backyard', ['C.....C', '.......', 'C.....C']);
  const cx = 3 * TILE;
  const cy = TILE;
  ctx.drawImage(getSplash('center', Dir.None, 1, cb), cx, cy);
  ctx.drawImage(getSplash('arm', Dir.Left, 1, cb), cx - TILE, cy);
  ctx.drawImage(getSplash('end', Dir.Left, 1, cb), cx - 2 * TILE, cy);
  ctx.drawImage(getSplash('arm', Dir.Right, 1, cb), cx + TILE, cy);
  ctx.drawImage(getCastleCrumble('backyard', 1), cx + 2 * TILE, cy);
  ctx.drawImage(getSplash('end', Dir.Right, 1, cb), cx + 2 * TILE, cy);
  ctx.drawImage(getSplash('end', Dir.Up, 1, cb), cx, cy - TILE);
  ctx.drawImage(getSplash('end', Dir.Down, 1, cb), cx, cy + TILE);
  critterAt(ctx, 6, 1, Dir.Down, 0);
  return cv;
}

/** Rubber Boots: a critter kicks a balloon, which slides toward a sandcastle. */
export function kickArt(): HTMLCanvasElement {
  const cb = settings.get().colorblind;
  const { cv, ctx } = scene('beach', ['......C']);
  critterAt(ctx, 0, 0, Dir.Right, 1, 1);
  ctx.drawImage(getSlidingBalloon(Dir.Right, 1, cb, false), 3 * TILE, 0);
  return cv;
}

const TIDE_ROWS = ['.......', '.......', '.......'];
export const TIDE_ART_W = TIDE_ROWS[0].length * TILE;
export const TIDE_ART_H = TIDE_ROWS.length * TILE;

/** Rising tide flooding the arena edge, a soaked critter riding a revenge duck on it. */
export function paintTideArt(target: CanvasRenderingContext2D, frame: number): void {
  const cb = settings.get().colorblind;
  const { cv, ctx } = scene('pool', TIDE_ROWS);
  for (let x = 0; x < TIDE_ROWS[0].length; x++) {
    drawWater(ctx, x * TILE, 0, frame);
    ctx.drawImage(getWaterEdge(Dir.Down, frame), x * TILE, 0);
  }
  critterAt(ctx, 4, 2, Dir.Down, 0);
  ctx.drawImage(getBalloon(2, 3, cb, true), 2 * TILE, 2 * TILE);
  const duck = getDuckRide('cat', frame, 3, cb);
  ctx.drawImage(duck, 2 * TILE + TILE / 2 - DUCK_RIDE_ANCHOR.x, TILE / 2 + 2 - DUCK_RIDE_ANCHOR.y);
  target.drawImage(cv, 0, 0);
}
