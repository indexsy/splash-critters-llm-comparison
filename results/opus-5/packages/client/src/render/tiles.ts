/**
 * The static layer: floor, boulders, sandcastles and the rising tide.
 *
 * Tiles are drawn straight to the context rather than through a Pen because they
 * are already axis-aligned on a 16px grid, and this layer redraws every frame for
 * every tile of the arena - the cheapest possible path matters here.
 */

import { type MapTheme } from '@splash/shared';
import { UI, shade, tint, type ArenaLayout, type ThemePalette } from './palette';

/** Cheap deterministic hash so speckles stay put instead of crawling. */
function hash(x: number, y: number): number {
  const value = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
  return (value >>> 0) % 1000;
}

export function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tile: number,
  palette: ThemePalette,
  tx: number,
  ty: number,
): void {
  ctx.fillStyle = (tx + ty) % 2 === 0 ? palette.floorA : palette.floorB;
  ctx.fillRect(sx, sy, tile, tile);
  // Two fixed speckles per tile break up the flat colour without any noise.
  const h = hash(tx, ty);
  ctx.fillStyle = shade(palette.floorA, 0.12);
  ctx.fillRect(sx + (h % 13) + 1, sy + (Math.floor(h / 13) % 13) + 1, 1, 1);
  ctx.fillStyle = tint(palette.floorB, 0.1);
  ctx.fillRect(sx + (Math.floor(h / 7) % 13) + 2, sy + (h % 11) + 3, 1, 1);
}

function drawBoulderDetail(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tile: number,
  theme: MapTheme,
  palette: ThemePalette,
  tx: number,
  ty: number,
): void {
  const dark = shade(palette.boulderShade, 0.25);
  const light = tint(palette.boulder, 0.25);
  if (theme === 'backyard') {
    // Fence posts with a rail across them.
    ctx.fillStyle = dark;
    ctx.fillRect(sx + 3, sy + 2, 3, tile - 4);
    ctx.fillRect(sx + 10, sy + 2, 3, tile - 4);
    ctx.fillStyle = light;
    ctx.fillRect(sx + 3, sy + 2, 1, tile - 4);
    ctx.fillRect(sx + 10, sy + 2, 1, tile - 4);
    ctx.fillStyle = palette.boulderShade;
    ctx.fillRect(sx + 1, sy + 6, tile - 2, 2);
    ctx.fillStyle = light;
    ctx.fillRect(sx + 1, sy + 6, tile - 2, 1);
    return;
  }
  if (theme === 'beach') {
    // A cluster of rocks, seeded per tile so no two look identical.
    const h = hash(tx, ty);
    ctx.fillStyle = dark;
    ctx.fillRect(sx + 2 + (h % 3), sy + 3, 6, 5);
    ctx.fillRect(sx + 8, sy + 7 + (h % 2), 5, 5);
    ctx.fillStyle = light;
    ctx.fillRect(sx + 3 + (h % 3), sy + 4, 3, 1);
    ctx.fillRect(sx + 9, sy + 8 + (h % 2), 2, 1);
    return;
  }
  // Pool: a grid of glazed tiles with grouted seams.
  ctx.fillStyle = dark;
  ctx.fillRect(sx, sy + 7, tile, 1);
  ctx.fillRect(sx + 7, sy, 1, tile);
  ctx.fillStyle = light;
  ctx.fillRect(sx + 2, sy + 2, 3, 1);
  ctx.fillRect(sx + 10, sy + 10, 3, 1);
}

export function drawBoulder(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tile: number,
  theme: MapTheme,
  palette: ThemePalette,
  tx: number,
  ty: number,
): void {
  ctx.fillStyle = palette.boulder;
  ctx.fillRect(sx, sy, tile, tile);
  ctx.fillStyle = tint(palette.boulder, 0.35);
  ctx.fillRect(sx, sy, tile, 1);
  ctx.fillRect(sx, sy, 1, tile);
  ctx.fillStyle = palette.boulderShade;
  ctx.fillRect(sx, sy + tile - 2, tile, 2);
  ctx.fillRect(sx + tile - 2, sy, 2, tile);
  drawBoulderDetail(ctx, sx, sy, tile, theme, palette, tx, ty);
  ctx.fillStyle = shade(palette.boulderShade, 0.45);
  ctx.fillRect(sx, sy + tile - 1, tile, 1);
  ctx.fillRect(sx + tile - 1, sy, 1, tile);
}

export function drawCastle(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tile: number,
  palette: ThemePalette,
): void {
  const top = sy + 4;
  ctx.fillStyle = palette.castle;
  ctx.fillRect(sx + 1, top, tile - 2, tile - 5);
  // Three crenellations, which is what makes a block read as a sandcastle.
  for (const dx of [1, 6, 11]) {
    ctx.fillRect(sx + dx, sy + 1, 4, 4);
  }
  ctx.fillStyle = tint(palette.castle, 0.3);
  for (const dx of [1, 6, 11]) {
    ctx.fillRect(sx + dx, sy + 1, 4, 1);
  }
  ctx.fillRect(sx + 1, top, tile - 2, 1);
  ctx.fillStyle = palette.castleShade;
  ctx.fillRect(sx + tile - 3, top, 2, tile - 5);
  ctx.fillRect(sx + 1, sy + tile - 2, tile - 2, 1);
  for (const dx of [1, 6, 11]) {
    ctx.fillRect(sx + dx + 3, sy + 1, 1, 4);
  }
  // Doorway, so the tower has a front.
  ctx.fillStyle = shade(palette.castleShade, 0.35);
  ctx.fillRect(sx + 6, sy + 10, 4, 5);
  ctx.fillStyle = palette.castleShade;
  ctx.fillRect(sx + 6, sy + 10, 4, 1);
}

export function drawWater(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tile: number,
  tx: number,
  ty: number,
  tick: number,
): void {
  ctx.fillStyle = UI.water;
  ctx.fillRect(sx, sy, tile, tile);
  ctx.fillStyle = shade(UI.water, 0.25);
  ctx.fillRect(sx, sy, tile, 2);

  // Two shimmer streaks slide sideways at different rates so the surface never
  // looks like it is scrolling as one sheet.
  const drift = tick * 0.35 + tx * 3 + ty * 5;
  ctx.fillStyle = UI.waterLight;
  const a = Math.floor(((drift % 16) + 16) % 16);
  const b = Math.floor(((drift * 0.6 + 8) % 16 + 16) % 16);
  ctx.fillRect(sx + a, sy + 5, Math.min(5, tile - a), 1);
  ctx.fillRect(sx + b, sy + 11, Math.min(4, tile - b), 1);
  ctx.fillStyle = tint(UI.waterLight, 0.5);
  ctx.fillRect(sx + ((a + 6) % (tile - 1)), sy + 8, 2, 1);
}

/** The floor pass. Water and props are drawn over the top by the caller. */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ThemePalette,
  layout: ArenaLayout,
): void {
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      drawFloorTile(
        ctx,
        layout.originX + tx * layout.tile,
        layout.originY + ty * layout.tile,
        layout.tile,
        palette,
        tx,
        ty,
      );
    }
  }
}
