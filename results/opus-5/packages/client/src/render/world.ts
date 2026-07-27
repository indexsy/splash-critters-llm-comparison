/**
 * The arena renderer: one function that paints a whole frame of the field from a
 * flat snapshot, so the game screen never has to know how anything is drawn.
 *
 * Painter's order is deliberate - floor, blockers, water, loose props, then
 * critters sorted by y so a critter standing lower on the screen overlaps one
 * standing behind it, then the border ducks and finally the speech bubbles,
 * which must never be hidden by anything.
 */

import {
  CONFIG,
  DIR_VECTORS,
  Dir,
  Tile,
  animalDef,
  perimeterPoint,
  type DirValue,
  type LobSnap,
  type MapTheme,
  type PowerupSnap,
  type SplashSnap,
} from '@splash/shared';
import {
  HUD_HEIGHT,
  SLOT_COLORS,
  UI,
  splashColors,
  themePalette,
  type ArenaLayout,
  type ThemePalette,
} from './palette';
import { drawBoulder, drawCastle, drawFloor, drawWater } from './tiles';
import { drawBalloon, drawCritter, drawDuck, drawLob, drawPowerup } from './sprites';
import { drawText, ellipsize } from './text';
import type { CritterLook } from './sprites';
import type { AnimalId, HatId } from '@splash/shared';

export interface RenderPlayer {
  slot: number;
  x: number;
  y: number;
  facing: DirValue;
  alive: boolean;
  moving: boolean;
  animal: AnimalId;
  hat: HatId;
  nickname: string;
  ghost: boolean;
  ghostPos: number;
  /** Ticks since the soak, or -1 while alive. Drives the soak animation. */
  soakAge: number;
  emote: number;
  emoteTicks: number;
}

export interface RenderBalloon {
  id: number;
  x: number;
  y: number;
  owner: number;
  burstTick: number;
}

export interface RenderState {
  width: number;
  height: number;
  cells: Uint8Array;
  theme: MapTheme;
  players: RenderPlayer[];
  balloons: RenderBalloon[];
  splashes: SplashSnap[];
  powerups: PowerupSnap[];
  lobs: LobSnap[];
  /** Fractional render tick, used for every animation phase. */
  tick: number;
}

const SOAK_TICKS = 30;
const DRAMATIC_SOAK_TICKS = 45;
/** Ticks the splash takes to reach its full length. */
const SPLASH_GROW_TICKS = 4;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lookOf(player: RenderPlayer): CritterLook {
  return { slot: player.slot, animal: player.animal, hat: player.hat };
}

function soakLength(animal: AnimalId): number {
  return animalDef(animal).dramaticSoak ? DRAMATIC_SOAK_TICKS : SOAK_TICKS;
}

function slotColor(slot: number): string {
  const count = SLOT_COLORS.length;
  return SLOT_COLORS[((Math.floor(slot) % count) + count) % count];
}

// -------------------------------------------------------------------- tiles

function drawBlockers(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  layout: ArenaLayout,
  palette: ThemePalette,
): void {
  for (let ty = 0; ty < state.height; ty++) {
    for (let tx = 0; tx < state.width; tx++) {
      const cell = state.cells[ty * state.width + tx];
      if (cell === Tile.EMPTY) continue;
      const sx = layout.originX + tx * layout.tile;
      const sy = layout.originY + ty * layout.tile;
      if (cell === Tile.BOULDER) {
        drawBoulder(ctx, sx, sy, layout.tile, state.theme, palette, tx, ty);
      } else if (cell === Tile.CASTLE) {
        drawCastle(ctx, sx, sy, layout.tile, palette);
      } else if (cell === Tile.WATER) {
        drawWater(ctx, sx, sy, layout.tile, tx, ty, state.tick);
      }
    }
  }
}

// ------------------------------------------------------------------ splashes

function armRect(
  sx: number,
  sy: number,
  tile: number,
  dir: DirValue,
  length: number,
  halfThickness: number,
): [number, number, number, number] {
  const midX = sx + tile / 2;
  const midY = sy + tile / 2;
  if (dir === Dir.RIGHT) return [sx, midY - halfThickness, length, halfThickness * 2];
  if (dir === Dir.LEFT) return [sx + tile - length, midY - halfThickness, length, halfThickness * 2];
  if (dir === Dir.DOWN) return [midX - halfThickness, sy, halfThickness * 2, length];
  return [midX - halfThickness, sy + tile - length, halfThickness * 2, length];
}

function drawArmTile(
  ctx: CanvasRenderingContext2D,
  layout: ArenaLayout,
  tx: number,
  ty: number,
  dir: DirValue,
  cover: number,
  tip: boolean,
  fade: number,
  colors: string[],
): void {
  const sx = layout.originX + tx * layout.tile;
  const sy = layout.originY + ty * layout.tile;
  const horizontal = dir === Dir.LEFT || dir === Dir.RIGHT;
  // A capped tip spreads sideways and stops short, as if it hit something.
  const halfThickness = Math.max(1, Math.round((tip ? 7 : 5) * fade));
  const length = Math.max(1, Math.round(layout.tile * cover * (tip ? 0.85 : 1)));

  const [x, y, w, h] = armRect(sx, sy, layout.tile, dir, length, halfThickness);
  ctx.fillStyle = colors[1];
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  const inset = Math.max(1, halfThickness - 2);
  const [ix, iy, iw, ih] = armRect(sx, sy, layout.tile, dir, length, inset);
  ctx.fillStyle = colors[0];
  ctx.fillRect(Math.round(ix), Math.round(iy), Math.round(iw), Math.round(ih));
  ctx.fillStyle = colors[2];
  if (horizontal) {
    ctx.fillRect(Math.round(x + w * 0.35), Math.round(y + 1), 2, 1);
    ctx.fillRect(Math.round(x + w * 0.7), Math.round(y + h - 2), 1, 1);
  } else {
    ctx.fillRect(Math.round(x + 1), Math.round(y + h * 0.35), 1, 2);
    ctx.fillRect(Math.round(x + w - 2), Math.round(y + h * 0.7), 1, 1);
  }
}

function drawSplash(
  ctx: CanvasRenderingContext2D,
  splash: SplashSnap,
  layout: ArenaLayout,
  tick: number,
): void {
  const remaining = splash.endTick - tick;
  const age = CONFIG.SPLASH_TICKS - remaining;
  if (age < 0) return;
  const grow = clamp01(age / SPLASH_GROW_TICKS);
  const fade = remaining < 3 ? clamp01(remaining / 3) : 1;
  const colors = splashColors();

  const sx = layout.originX + splash.x * layout.tile;
  const sy = layout.originY + splash.y * layout.tile;
  const midX = sx + layout.tile / 2;
  const midY = sy + layout.tile / 2;
  const half = Math.max(2, Math.round((3 + 5 * grow) * fade));
  ctx.fillStyle = colors[1];
  ctx.fillRect(midX - half, midY - half + 1, half * 2, half * 2 - 2);
  ctx.fillRect(midX - half + 1, midY - half, half * 2 - 2, half * 2);
  ctx.fillStyle = colors[0];
  ctx.fillRect(midX - half + 2, midY - half + 2, half * 2 - 4, half * 2 - 4);
  ctx.fillStyle = colors[2];
  ctx.fillRect(midX - 1, midY - 1, 2, 2);

  const dirs: DirValue[] = [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT];
  for (const dir of dirs) {
    const reach = splash.arms[dir] ?? 0;
    if (reach <= 0) continue;
    const reached = reach * grow;
    const [dx, dy] = DIR_VECTORS[dir];
    for (let step = 1; step <= reach; step++) {
      const cover = clamp01(reached - (step - 1));
      if (cover <= 0) break;
      drawArmTile(
        ctx,
        layout,
        splash.x + dx * step,
        splash.y + dy * step,
        dir,
        cover,
        step === reach && (splash.capped[dir] ?? false),
        fade,
        colors,
      );
    }
  }
}

// -------------------------------------------------------------------- emotes

/** 5x5 glyphs: shout, grin, question, heart. */
const EMOTE_GLYPHS: number[][] = [
  [0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  [0b01010, 0b01010, 0b00000, 0b10001, 0b01110],
  [0b01110, 0b00010, 0b00110, 0b00000, 0b00100],
  [0b01010, 0b11111, 0b11111, 0b01110, 0b00100],
];

function drawEmoteBubble(ctx: CanvasRenderingContext2D, px: number, py: number, emote: number): void {
  const glyph = EMOTE_GLYPHS[emote % EMOTE_GLYPHS.length];
  const x = Math.round(px) - 6;
  const y = Math.max(HUD_HEIGHT + 1, Math.round(py) - 21);
  ctx.fillStyle = UI.shadow;
  ctx.fillRect(x, y + 1, 13, 9);
  ctx.fillRect(x + 1, y, 11, 11);
  ctx.fillStyle = UI.ink;
  ctx.fillRect(x + 1, y + 1, 11, 9);
  ctx.fillRect(x + 2, y, 9, 11);
  ctx.fillStyle = UI.shadow;
  ctx.fillRect(x + 5, y + 11, 3, 2);
  ctx.fillRect(x + 5, y + 13, 1, 1);
  ctx.fillStyle = UI.bg;
  for (let row = 0; row < glyph.length; row++) {
    const bits = glyph[row];
    for (let col = 0; col < 5; col++) {
      if ((bits & (1 << (4 - col))) === 0) continue;
      ctx.fillRect(x + 4 + col, y + 3 + row, 1, 1);
    }
  }
}

// ------------------------------------------------------------------ critters

function drawCritters(ctx: CanvasRenderingContext2D, state: RenderState, layout: ArenaLayout): void {
  const walkFrame = Math.floor(state.tick / 4) % 2;
  const order = state.players.slice().sort((a, b) => a.y - b.y);

  for (const player of order) {
    const px = layout.originX + player.x * layout.tile;
    const py = layout.originY + player.y * layout.tile;
    if (player.alive) {
      drawCritter(ctx, lookOf(player), px, py, player.facing, player.moving ? walkFrame : 0);
      continue;
    }
    if (player.soakAge < 0) continue;
    const length = soakLength(player.animal);
    if (player.soakAge >= length) continue;
    drawCritter(ctx, lookOf(player), px, py, player.facing, 0, {
      soakProgress: player.soakAge / length,
    });
  }
}

function drawGhosts(ctx: CanvasRenderingContext2D, state: RenderState, layout: ArenaLayout): void {
  const paddleFrame = Math.floor(state.tick / 6) % 2;
  for (const player of state.players) {
    if (player.alive || !player.ghost) continue;
    if (player.soakAge >= 0 && player.soakAge < soakLength(player.animal)) continue;
    const point = perimeterPoint(state.width, state.height, player.ghostPos);
    drawDuck(
      ctx,
      lookOf(player),
      layout.originX + point.x * layout.tile,
      layout.originY + point.y * layout.tile,
      paddleFrame,
    );
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, state: RenderState, layout: ArenaLayout): void {
  for (const player of state.players) {
    // A ghost's own x/y is frozen where it was soaked, so follow the duck.
    const riding = !player.alive && player.ghost && player.soakAge >= soakLength(player.animal);
    const spot = riding
      ? perimeterPoint(state.width, state.height, player.ghostPos)
      : { x: player.x, y: player.y };
    const px = layout.originX + spot.x * layout.tile;
    const py = layout.originY + spot.y * layout.tile - (riding ? 5 : 0);
    if (player.emoteTicks > 0) {
      drawEmoteBubble(ctx, px, py, player.emote);
      continue;
    }
    if (!player.alive) continue;
    const y = Math.max(HUD_HEIGHT + 1, Math.round(py) - 17);
    drawText(ctx, ellipsize(player.nickname, 8), Math.round(px), y, slotColor(player.slot), {
      align: 'center',
      shadow: UI.shadow,
    });
  }
}

// ---------------------------------------------------------------------- pass

export function drawArena(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  layout: ArenaLayout,
): void {
  const palette = themePalette(state.theme);
  drawFloor(ctx, state.width, state.height, palette, layout);
  drawBlockers(ctx, state, layout, palette);

  for (const powerup of state.powerups) {
    drawPowerup(
      ctx,
      powerup.type,
      layout.originX + powerup.x * layout.tile + layout.tile / 2,
      layout.originY + powerup.y * layout.tile + layout.tile / 2,
      state.tick * 0.15 + powerup.id * 1.7,
    );
  }

  for (const balloon of state.balloons) {
    const fuse = clamp01(1 - (balloon.burstTick - state.tick) / CONFIG.FUSE_TICKS);
    drawBalloon(
      ctx,
      layout.originX + balloon.x * layout.tile,
      layout.originY + balloon.y * layout.tile,
      fuse,
      balloon.owner,
    );
  }

  for (const splash of state.splashes) drawSplash(ctx, splash, layout, state.tick);

  for (const lob of state.lobs) {
    drawLob(
      ctx,
      layout.originX + lob.x * layout.tile,
      layout.originY + lob.y * layout.tile,
      state.tick * 0.4 + lob.id,
    );
  }

  drawCritters(ctx, state, layout);
  drawGhosts(ctx, state, layout);
  drawLabels(ctx, state, layout);
}
