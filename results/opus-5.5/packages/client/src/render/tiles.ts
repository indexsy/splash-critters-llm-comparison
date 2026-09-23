// Tilesets: three themes (backyard / beach / pool) as pure reskins over identical logic.
// Floors have deterministic per-(x, y, seed) detail variants plus a drop shadow under solid
// tiles; the tide water tile has a seamless 4-frame shimmer. Obstacle art (castles, crumble
// frames, pillars, border ring) lives in sprites-terrain.ts and is composed here.
//
// World renderer usage:
//   drawArena(ctx, theme, tiles, w, h, seed, ox, oy)  whole static layer (cache it offscreen)
//   drawArenaTile(...)                                one tile; after castle_washed at (x, y)
//                                                     redraw (x, y) and (x, y + 1) (shadow)
//   getCastleCrumble(theme, frame) over a washed tile, getWaterTile(frame) on flooded tiles,
//   getWaterEdge(dir, frame) on flooded tiles next to dry ground (foam line on that side).
import { Dir, Tile, type DirCode, type Theme } from '@splash/shared';
import { PAL, THEME_PALETTES, TIDE, type ThemePalette } from './palette';
import { PixelGrid, cached, hashInts } from './pixelart';
import { borderPieceAt, getBorderTile, getCastleTile, getPillarTile } from './sprites-terrain';

export const TILE = 16;
export const FLOOR_VARIANTS = 4;
export const WATER_FRAMES = 4;
/** Suggested time per tide shimmer frame. */
export const WATER_FRAME_MS = 220;

/** Deterministic floor detail variant for a tile: mostly plain, sometimes decorated. */
function floorVariant(x: number, y: number, seed: number): number {
  const r = hashInts(x, y, seed) % 100;
  return r < 58 ? 0 : r < 74 ? 1 : r < 87 ? 2 : 3;
}

type Detail = (g: PixelGrid, t: ThemePalette) => void;

function blades(g: PixelGrid, t: ThemePalette, spots: readonly [number, number][]): void {
  for (const [x, y] of spots) g.set(x, y, t.floorDetail).set(x + 1, y - 1, t.floorDetail).set(x + 2, y, t.floorDetail);
}

const GRASS: readonly Detail[] = [
  (g, t) => blades(g, t, [[3, 5], [10, 11]]),
  (g, t) => {
    blades(g, t, [[4, 10], [7, 9], [10, 10]]);
    [[5, 8], [8, 7], [11, 8]].forEach(([x, y]) => g.set(x, y, t.floorDetailLight));
    blades(g, t, [[11, 3]]);
  },
  (g, t) => {
    g.set(10, 4, t.accentA).set(9, 4, t.accentB).set(11, 4, t.accentB).set(10, 3, t.accentB).set(10, 5, t.accentB);
    g.set(4, 11, t.accentA).set(3, 11, t.accentB).set(5, 11, t.accentB).set(4, 10, t.accentB).set(4, 12, t.accentB);
    blades(g, t, [[12, 12]]);
  },
  (g, t) => {
    for (const [cx, cy] of [[5, 5], [11, 10]]) {
      g.set(cx, cy, t.floorDetailLight).set(cx + 1, cy, t.floorDetailLight).set(cx, cy + 1, t.floorDetailLight);
      g.set(cx - 1, cy + 1, t.floorDetailLight).set(cx + 1, cy + 1, t.floorDetail).set(cx, cy + 2, t.floorDetail);
    }
  },
];

const SAND: readonly Detail[] = [
  (g, t) => [[3, 4], [11, 6], [6, 12], [13, 13]].forEach(([x, y]) => g.set(x, y, t.floorDetail)),
  (g, t) => {
    g.rect(8, 8, 5, 3, t.accentA).hline(9, 11, 7, t.accentA).set(10, 11, t.floorDetail);
    [9, 11].forEach((x) => g.vline(x, 8, 10, PAL.pink));
    [[3, 4], [5, 13]].forEach(([x, y]) => g.set(x, y, t.floorDetail));
  },
  (g, t) => {
    const star: [number, number][] = [[5, 4], [5, 5], [5, 6], [3, 5], [4, 5], [6, 5], [7, 5], [4, 7], [6, 7], [5, 3]];
    star.forEach(([x, y]) => g.set(x, y, t.accentB));
    g.set(5, 5, PAL.yellow);
    g.set(12, 12, t.floorDetail);
  },
  (g, t) => {
    for (const y of [5, 11]) for (let x = 2; x < 14; x++) if ((x + (y === 5 ? 0 : 2)) % 5 !== 0) g.set(x, y + (x % 4 < 2 ? 0 : 1), t.floorDetail);
    g.set(12, 8, PAL.greyLight).set(13, 8, PAL.grey);
  },
];

function poolGrid(g: PixelGrid, t: ThemePalette): void {
  g.hline(0, 15, 0, t.floorDetail).hline(0, 15, 8, t.floorDetail);
  g.vline(0, 0, 15, t.floorDetail).vline(8, 0, 15, t.floorDetail);
}

function caustic(g: PixelGrid, t: ThemePalette, y0: number, phase: number): void {
  for (let x = 1; x < 15; x++) if ((x + phase) % 7 !== 0) g.set(x, y0 + Math.round(Math.sin((x + phase) * 0.9)), t.floorDetailLight);
}

const POOL: readonly Detail[] = [
  poolGrid,
  (g, t) => {
    poolGrid(g, t);
    caustic(g, t, 4, 0);
  },
  (g, t) => {
    poolGrid(g, t);
    g.rect(9, 9, 7, 7, t.floorDetail).rect(11, 11, 3, 3, t.floorB);
  },
  (g, t) => {
    poolGrid(g, t);
    caustic(g, t, 11, 3);
  },
];

const DETAILS: Record<Theme, readonly Detail[]> = { backyard: GRASS, beach: SAND, pool: POOL };

function floorGrid(theme: Theme, variant: number, checker: number, shaded: boolean, flip: boolean): PixelGrid {
  const t = THEME_PALETTES[theme];
  let g = new PixelGrid(TILE, TILE, checker ? t.floorB : t.floorA);
  DETAILS[theme][variant](g, t);
  if (flip && theme !== 'pool') g = g.flipX();
  if (shaded) g.rect(0, 0, TILE, 3, t.floorShade);
  return g;
}

/**
 * Cached floor tile. `checker` alternates the base shade per tile ((x + y) & 1), `shaded`
 * draws the drop shadow cast by a solid tile directly above, `flip` mirrors the details.
 */
export function getFloorTile(theme: Theme, variant: number, checker: number, shaded: boolean, flip = false): HTMLCanvasElement {
  const v = ((variant % FLOOR_VARIANTS) + FLOOR_VARIANTS) % FLOOR_VARIANTS;
  return cached(`floor:${theme}:${v}:${checker & 1}:${shaded ? 1 : 0}:${flip ? 1 : 0}`, () =>
    floorGrid(theme, v, checker & 1, shaded, flip).toCanvas(),
  );
}

// ---------------------------------------------------------------------------------------
// Tide water
// ---------------------------------------------------------------------------------------

/** Wavelets [x, y, drift]: a light crest over a dark trough, drifting 4px per frame. */
const WAVELETS: readonly [number, number, number][] = [
  [0, 1, 1],
  [12, 4, -1],
  [8, 7, 1],
  [4, 9, -1],
  [4, 12, 1],
  [8, 14, -1],
];

function waterGrid(frame: number): PixelGrid {
  const g = new PixelGrid(TILE, TILE, TIDE.body);
  for (const [x0, y, drift] of WAVELETS) {
    const shift = (((x0 + drift * frame * 4) % TILE) + TILE) % TILE;
    for (let i = 0; i < 5; i++) {
      g.set((shift + i) % TILE, y, i === 0 || i === 4 ? TIDE.body : TIDE.light);
      g.set((shift + i + 1) % TILE, (y + 1) % TILE, TIDE.deep);
    }
    if ((frame + y) % 2 === 0) g.set((shift + 2) % TILE, y, TIDE.sparkle);
  }
  return g;
}

/** Cached tide water tile (seamless when tiled), WATER_FRAMES shimmer frames. */
export function getWaterTile(frame: number): HTMLCanvasElement {
  const f = ((frame % WATER_FRAMES) + WATER_FRAMES) % WATER_FRAMES;
  return cached(`water:${f}`, () => waterGrid(f).toCanvas());
}

/** Draw a tide water tile at pixel (px, py). */
export function drawWater(ctx: CanvasRenderingContext2D, px: number, py: number, frame: number): void {
  ctx.drawImage(getWaterTile(frame), px, py);
}

/**
 * Cached foam line overlay for a flooded tile whose `dir` neighbour is still dry
 * (e.g. Dir.Down = foam along the bottom edge).
 */
export function getWaterEdge(dir: DirCode, frame: number): HTMLCanvasElement {
  const f = ((frame % WATER_FRAMES) + WATER_FRAMES) % WATER_FRAMES;
  return cached(`water-edge:${dir}:${f}`, () => {
    const g = new PixelGrid(TILE, TILE);
    for (let x = 0; x < TILE; x++) {
      const bump = (x + f * 2) % 8 < 3 ? 1 : 0;
      g.set(x, TILE - 1, TIDE.sparkle).set(x, TILE - 2, bump ? TIDE.sparkle : TIDE.light);
      if (bump) g.set(x, TILE - 3, TIDE.light);
    }
    const turns = dir === Dir.Left ? 1 : dir === Dir.Up ? 2 : dir === Dir.Right ? 3 : 0;
    return g.rotate(turns).toCanvas();
  });
}

// ---------------------------------------------------------------------------------------
// Arena composition
// ---------------------------------------------------------------------------------------

function isSolid(tiles: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const k = tiles[y * w + x];
  return k === Tile.Boulder || k === Tile.Castle;
}

/**
 * Draw arena tile (tx, ty) at pixel (px, py): border ring piece, or floor plus pillar /
 * castle overlay. `seed` picks the floor variants deterministically (use round_start.mapSeed).
 */
export function drawArenaTile(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  tiles: Uint8Array,
  w: number,
  h: number,
  tx: number,
  ty: number,
  seed: number,
  px: number,
  py: number,
): void {
  const kind = tiles[ty * w + tx];
  const ring = Math.min(tx, ty, w - 1 - tx, h - 1 - ty);
  if (kind === Tile.Boulder && ring === 0) {
    ctx.drawImage(getBorderTile(theme, borderPieceAt(tx, ty, w, h)), px, py);
    return;
  }
  const hash = hashInts(tx, ty, seed, 7);
  const shaded = isSolid(tiles, w, h, tx, ty - 1);
  ctx.drawImage(getFloorTile(theme, floorVariant(tx, ty, seed), (tx + ty) & 1, shaded, (hash & 1) === 1), px, py);
  if (kind === Tile.Boulder) ctx.drawImage(getPillarTile(theme, (hash >> 1) & 1), px, py);
  else if (kind === Tile.Castle) ctx.drawImage(getCastleTile(theme), px, py);
}

/** Draw every tile of a w x h arena with its top-left corner at (ox, oy). */
export function drawArena(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  tiles: Uint8Array,
  w: number,
  h: number,
  seed: number,
  ox = 0,
  oy = 0,
): void {
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) drawArenaTile(ctx, theme, tiles, w, h, tx, ty, seed, ox + tx * TILE, oy + ty * TILE);
  }
}

export { CASTLE_CRUMBLE_FRAMES, PILLAR_VARIANTS, borderPieceAt, getBorderTile, getCastleCrumble, getCastleTile, getPillarTile } from './sprites-terrain';
export type { BorderPiece } from './sprites-terrain';
