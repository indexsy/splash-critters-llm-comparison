// Critters in the arena: walking (walk cycle, facing, hats), soaking (the cat is extra
// dramatic), riding revenge ducks along the border with a lob-cooldown gauge, emote bubbles and
// the "YOU" marker that helps the local player find their critter at round start.
import { CONFIG, type MatchPlayerInfo } from '@splash/shared';
import type { ActorView } from '../game/scene';
import { subToPx } from './camera';
import { EMOTE_MS, FLOATER_MS, SOAK_LINGER_MS, type EmoteFx, type FloaterFx, type SoakFx } from './fx';
import { drawLabel } from './label';
import { PAL, slotColor } from './palette';
import {
  CRITTER_OY,
  DUCK_RIDE_ANCHOR,
  DUCK_RIDE_FRAMES,
  DUCK_RIDE_H,
  DUCK_RIDE_W,
  EMOTE_BUBBLE_H,
  SOAK_FRAME_MS,
  SOAK_OX,
  SOAK_OY,
  animalFrameAt,
  getCritter,
  getDuckRide,
  getEmoteBubble,
  getShadow,
  getSoakFrame,
  soakFrameCount,
} from './sprites';

const HALF = 8;
/** Rider sprites may rise at most this far above the arena's top edge (the HUD sits there). */
const DUCK_TOP_MARGIN = 2;

export interface ActorArt {
  info: MatchPlayerInfo;
  colorblind: boolean;
}

/** A dry critter at its render position (arena pixel center cx, cy). */
export function drawCritter(ctx: CanvasRenderingContext2D, a: ActorView, art: ActorArt, cx: number, cy: number, nowMs: number): void {
  const frame = animalFrameAt(a.moving, nowMs + a.slot * 37);
  const hatFrame = a.moving ? Math.floor(nowMs / 70) : 0;
  const sprite = getCritter(art.info.animal, art.info.hat, a.facing, frame, a.slot, art.colorblind, hatFrame);
  ctx.drawImage(getShadow(12), cx - 6, cy + 5);
  ctx.drawImage(sprite, cx - HALF, cy - HALF - CRITTER_OY);
}

/** The soak animation at the spot the critter was hit; the puddle fades out at the end. */
export function drawSoak(ctx: CanvasRenderingContext2D, soak: SoakFx, slot: number, art: ActorArt, ox: number, oy: number, nowMs: number): void {
  const elapsed = nowMs - soak.startMs;
  const count = soakFrameCount(art.info.animal);
  const animMs = count * SOAK_FRAME_MS;
  if (elapsed >= animMs + SOAK_LINGER_MS) return;
  const frame = Math.min(count - 1, Math.floor(elapsed / SOAK_FRAME_MS));
  const cx = ox + subToPx(soak.x);
  const cy = oy + subToPx(soak.y);
  ctx.globalAlpha = elapsed > animMs ? Math.max(0, 1 - (elapsed - animMs) / SOAK_LINGER_MS) : 1;
  ctx.drawImage(getSoakFrame(art.info.animal, frame, slot, art.colorblind), cx - HALF - SOAK_OX, cy - HALF - SOAK_OY);
  ctx.globalAlpha = 1;
}

/** Lob-cooldown gauge under a duck: fills up, then blinks when a lob is ready. */
function drawCooldownGauge(ctx: CanvasRenderingContext2D, cx: number, y: number, cooldownTicks: number, slot: number, colorblind: boolean, nowMs: number): void {
  const w = 12;
  const x = cx - w / 2;
  const ready = cooldownTicks <= 0;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 1, y - 1, w + 2, 4);
  if (ready) {
    ctx.fillStyle = Math.floor(nowMs / 200) % 2 === 0 ? PAL.yellow : PAL.white;
    ctx.fillRect(x, y, w, 2);
    return;
  }
  const filled = Math.round(w * (1 - Math.min(1, cooldownTicks / CONFIG.DUCK_LOB_COOLDOWN_TICKS)));
  ctx.fillStyle = PAL.greyDark;
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = slotColor(slot, colorblind).main;
  ctx.fillRect(x, y, filled, 2);
}

/** Arena rectangle (screen pixels) that rider sprites are kept inside. */
export interface ArenaBounds {
  left: number;
  top: number;
  right: number;
}

/**
 * A soaked player riding its rubber duck along the border, with its lob-cooldown gauge. The
 * rider is taller and wider than a tile, so on the outer edges it is nudged inward to stay
 * whole inside the arena (the HUD strip sits right above it).
 */
export function drawDuck(ctx: CanvasRenderingContext2D, a: ActorView, art: ActorArt, arena: ArenaBounds, cx: number, cy: number, nowMs: number): void {
  const frame = Math.floor(nowMs / 260 + a.slot) % DUCK_RIDE_FRAMES;
  const sprite = getDuckRide(art.info.animal, frame, a.slot, art.colorblind, art.info.hat);
  const top = Math.max(arena.top - DUCK_TOP_MARGIN, cy - DUCK_RIDE_ANCHOR.y);
  const left = Math.min(arena.right - DUCK_RIDE_W, Math.max(arena.left, cx - DUCK_RIDE_ANCHOR.x));
  ctx.drawImage(sprite, left, top);
  drawCooldownGauge(ctx, left + DUCK_RIDE_ANCHOR.x, top + DUCK_RIDE_H - 2, a.duckCooldown, a.slot, art.colorblind, nowMs);
}

/** Pixel speech bubble above a critter (tail bottom-left), popping in and fading out. */
export function drawEmote(ctx: CanvasRenderingContext2D, e: EmoteFx, headX: number, headY: number, minY: number, nowMs: number): void {
  const t = nowMs - e.startMs;
  if (t < 0 || t >= EMOTE_MS) return;
  const rise = t < 120 ? 2 : 0;
  const y = Math.max(minY, headY - EMOTE_BUBBLE_H - rise);
  ctx.globalAlpha = t > EMOTE_MS - 250 ? (EMOTE_MS - t) / 250 : 1;
  ctx.drawImage(getEmoteBubble(e.id), headX - 3, y);
  ctx.globalAlpha = 1;
}

/** Bouncing "YOU" tag with an arrow over the local critter (round start). */
export function drawYouMarker(ctx: CanvasRenderingContext2D, cx: number, headY: number, slot: number, colorblind: boolean, minY: number, nowMs: number): void {
  const bounce = Math.floor(nowMs / 180) % 2;
  const color = slotColor(slot, colorblind);
  const y = Math.max(minY, headY - 13 - bounce);
  drawLabel(ctx, 'YOU', cx, y, { font: 'small', color: color.light, outline: PAL.ink });
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(cx - 3, y + 7, 7, 1);
  ctx.fillRect(cx - 2, y + 8, 5, 1);
  ctx.fillRect(cx - 1, y + 9, 3, 1);
  ctx.fillStyle = color.main;
  ctx.fillRect(cx - 2, y + 7, 5, 1);
  ctx.fillRect(cx - 1, y + 8, 3, 1);
}

/** Pickup text rising from where it was collected, blinking out at the end. */
export function drawFloater(ctx: CanvasRenderingContext2D, f: FloaterFx, ox: number, oy: number, minY: number, nowMs: number): void {
  const t = (nowMs - f.startMs) / FLOATER_MS;
  if (t < 0 || t >= 1 || (t > 0.75 && Math.floor(nowMs / 60) % 2 === 1)) return;
  const y = Math.max(minY, Math.round(oy + f.y - 14 - t * 10));
  drawLabel(ctx, f.text, ox + f.x, y, { font: 'small', color: f.color, outline: PAL.ink });
}
