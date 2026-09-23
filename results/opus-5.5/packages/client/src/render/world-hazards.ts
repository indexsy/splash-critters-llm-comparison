// Water balloons (fuse wobble/inflate from the server tick estimate, sliding after kicks,
// ghost drops awaiting confirmation), splash crosses and revenge-duck lobs in flight.
import { ALL_DIRS, CONFIG, DIR_DX, DIR_DY, Dir, type Balloon } from '@splash/shared';
import { subToPx } from './camera';
import { LOB_FLIGHT_MS, type LobFx, type SplashFx } from './fx';
import { balloonFrameAt, getBalloon, getShadow, getSlidingBalloon, getSplash, splashFrameAt } from './sprites';
import { TILE } from './tiles';

/** Kicked balloons slide 1000 sub-units per tick (KICK_SPEED tiles/s). */
const SLIDE_UNITS_PER_TICK = (CONFIG.KICK_SPEED * CONFIG.SUB) / CONFIG.TICK_RATE;
/** Extrapolate a sliding balloon at most this far past its snapshot (the next one corrects it). */
const SLIDE_LOOKAHEAD_TICKS = 2;
/** Balloons sit this many pixels above their tile's top edge (their sprite is bottom-heavy). */
const BALLOON_LIFT = 2;

/** Pixel center (arena coordinates) of a balloon; sliding ones glide between snapshots. */
export function balloonCenter(b: Balloon, estTick: number, snapshotTick: number): { x: number; y: number } {
  if (b.slideDir === Dir.None) return { x: b.tx * TILE + TILE / 2, y: b.ty * TILE + TILE / 2 };
  const ahead = Math.max(0, Math.min(SLIDE_LOOKAHEAD_TICKS, estTick - snapshotTick)) * SLIDE_UNITS_PER_TICK;
  return { x: subToPx(b.x + DIR_DX[b.slideDir] * ahead), y: subToPx(b.y + DIR_DY[b.slideDir] * ahead) };
}

export function drawBalloon(
  ctx: CanvasRenderingContext2D,
  b: Balloon,
  cx: number,
  cy: number,
  estTick: number,
  colorblind: boolean,
): void {
  const left = Math.round(cx - TILE / 2);
  const top = Math.round(cy - TILE / 2);
  ctx.drawImage(getShadow(10), left + 3, top + 12);
  if (b.slideDir !== Dir.None) {
    ctx.drawImage(getSlidingBalloon(b.slideDir, b.owner, colorblind, b.fromDuck), left, top - BALLOON_LIFT);
    return;
  }
  const fuse = Math.max(1, b.burstTick - b.placedTick);
  const frame = balloonFrameAt(b.burstTick - estTick, fuse, Math.floor(estTick));
  ctx.drawImage(getBalloon(frame, b.owner, colorblind, b.fromDuck), left, top - BALLOON_LIFT);
}

/** A predicted drop, drawn translucent until the server's balloon replaces it. */
export function drawGhostBalloon(ctx: CanvasRenderingContext2D, tx: number, ty: number, slot: number, ox: number, oy: number, colorblind: boolean): void {
  ctx.globalAlpha = 0.6;
  ctx.drawImage(getBalloon(0, slot, colorblind, false), ox + tx * TILE, oy + ty * TILE - BALLOON_LIFT);
  ctx.globalAlpha = 1;
}

/** Splash crosses: center, arm and end-cap tiles, framed over the splash's lifetime. */
export function drawSplashes(ctx: CanvasRenderingContext2D, splashes: readonly SplashFx[], ox: number, oy: number, nowMs: number, colorblind: boolean): void {
  for (const s of splashes) {
    const frame = splashFrameAt((nowMs - s.startMs) / CONFIG.TICK_MS, CONFIG.SPLASH_TICKS);
    ctx.drawImage(getSplash('center', Dir.None, frame, colorblind), ox + s.cx * TILE, oy + s.cy * TILE);
    ALL_DIRS.forEach((dir, arm) => {
      const len = s.arms[arm];
      for (let i = 1; i <= len; i++) {
        const tx = s.cx + DIR_DX[dir] * i;
        const ty = s.cy + DIR_DY[dir] * i;
        ctx.drawImage(getSplash(i === len ? 'end' : 'arm', dir, frame, colorblind), ox + tx * TILE, oy + ty * TILE);
      }
    });
  }
}

/** Position of a lob in flight: straight line on the ground plus a parabolic height. */
function lobPosition(l: LobFx, nowMs: number): { x: number; y: number; h: number; t: number } {
  const t = Math.min(1, Math.max(0, (nowMs - l.startMs) / LOB_FLIGHT_MS));
  const x = (l.fromX + (l.toX - l.fromX) * t) * TILE + TILE / 2;
  const y = (l.fromY + (l.toY - l.fromY) * t) * TILE + TILE / 2;
  return { x, y, h: 22 * 4 * t * (1 - t), t };
}

/** Revenge-duck balloons arcing from the border to their landing tile. */
export function drawLobs(ctx: CanvasRenderingContext2D, lobs: readonly LobFx[], ox: number, oy: number, nowMs: number, colorblind: boolean): void {
  for (const l of lobs) {
    const p = lobPosition(l, nowMs);
    if (p.t >= 1) continue;
    const gx = Math.round(ox + p.x);
    const gy = Math.round(oy + p.y);
    ctx.drawImage(getShadow(8), gx - 4, gy + 3);
    ctx.drawImage(getBalloon(Math.floor(nowMs / 90) % 2, l.slot, colorblind, true), gx - TILE / 2, Math.round(gy - TILE / 2 - p.h) - BALLOON_LIFT);
  }
}
