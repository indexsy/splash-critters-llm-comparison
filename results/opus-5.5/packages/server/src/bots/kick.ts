// Kicks (Hard bots with Rubber Boots): when the bot stands next to a resting balloon and kicking
// it down a straight corridor would trap or heavily pressure an opponent without endangering the
// bot, press into it. The slide is projected with the sim's rules (it stops in front of castles,
// boulders, balloons and players' tiles) and the result is judged on a hypothetical danger map.
import { ALL_DIRS, CONFIG, DIR_DX, DIR_DY, Dir, balloonAt, idx, tileCenter, tileOf, type DirCode, type PlayerState } from '@splash/shared';
import { threatOf } from './attack';
import { SAFETY_MARGIN, SEARCH_HORIZON, campUntil, type BotContext } from './context';
import { moverAtTile, predictStep, slideTargetFree } from './motion';
import { searchReach, type Mover } from './pathing';

export interface KickChoice {
  dir: DirCode;
  balloonId: number;
}

/** Ticks a kick is pressed for at most before the bot gives up on it. */
export const KICK_TICKS = 8;

/** Ticks a kicked balloon needs per tile (KICK_SPEED tiles/s). */
const TICKS_PER_TILE = Math.ceil(CONFIG.TICK_RATE / CONFIG.KICK_SPEED);

interface Slide {
  /** Tiles from the balloon's tile to where it rests; it enters path[k] on tick enter[k]. */
  path: number[];
  enter: number[];
  burstTick: number;
}


/**
 * Where a balloon at (bx, by) kicked toward `dir` on `kickTick` would burst, and what it passes.
 * It enters its k-th tile on kickTick + 3k - 2 (half a tile, then a tile every 3 ticks) and bursts
 * right there if that tile still holds lingering splash water.
 */
function projectKick(ctx: BotContext, bx: number, by: number, dir: DirCode, burstTick: number, kickTick: number): Slide | null {
  const { s } = ctx;
  const maxTiles = Math.floor((burstTick - kickTick) / TICKS_PER_TILE);
  const path = [idx(s.w, bx, by)];
  const enter = [ctx.tick];
  let x = bx;
  let y = by;
  for (let k = 1; k <= maxTiles && slideTargetFree(s, x + DIR_DX[dir], y + DIR_DY[dir]); k++) {
    x += DIR_DX[dir];
    y += DIR_DY[dir];
    const at = kickTick + TICKS_PER_TILE * k - 2;
    path.push(idx(s.w, x, y));
    enter.push(at);
    if (s.splashUntil[idx(s.w, x, y)] > at) return { path, enter, burstTick: at };
  }
  return path.length === 1 ? null : { path, enter, burstTick };
}

/** Longest walk (ticks) toward a kick position the bot plans for; farther means no kick. */
const MAX_KICK_WALK = 8;

/** On the lane center across `dir` and at (or past) the tile center along it: where the sim kicks. */
function clampedFacing(x: number, y: number, dir: DirCode): boolean {
  const vertical = dir === Dir.Up || dir === Dir.Down;
  const lane = vertical ? x : y;
  const along = vertical ? y : x;
  return lane === tileCenter(tileOf(lane)) && (along - tileCenter(tileOf(along))) * (DIR_DX[dir] + DIR_DY[dir]) >= 0;
}

/**
 * The tick on which pressing `dir` from now kicks the balloon ahead: the sim kicks within the
 * very tick the player's move leaves it clamped in front of the balloon (the shared movement,
 * replayed on a scratch copy). Infinity if that takes too long.
 */
function kickTickFor(ctx: BotContext, dir: DirCode): number {
  let p: PlayerState = ctx.me;
  for (let t = 1; t <= MAX_KICK_WALK; t++) {
    const pos = predictStep(ctx.s, p, dir);
    if (clampedFacing(pos.x, pos.y, dir)) return ctx.tick + t;
    p = { ...p, x: pos.x, y: pos.y };
  }
  return Infinity;
}

/**
 * Can the bot still get away if the kick never happens (someone steps into the balloon's path,
 * and it stays where it is), pressing until KICK_TICKS from now at the kick position `center`?
 */
function survivesFailedKick(ctx: BotContext, center: Mover): boolean {
  const until = ctx.tick + KICK_TICKS;
  if (!ctx.exact.isDryBetween(ctx.here, ctx.tick + 1, until + 1)) return false;
  const reach = searchReach({
    danger: ctx.exact,
    blocked: ctx.blocked,
    mover: center,
    startTick: until,
    campUntil: campUntil(ctx, until),
    horizon: until + SEARCH_HORIZON,
    margin: SAFETY_MARGIN,
    stopAfter: 1,
  });
  return reach.campTiles.length > 0;
}

/** A kick that traps or strongly pressures an opponent while the bot stays safe (kick or no kick), if any. */
export function findKick(ctx: BotContext): KickChoice | null {
  const { s, me } = ctx;
  if (!s.rules.kick || !me.canKick || ctx.opponents.length === 0) return null;
  const hx = ctx.here % s.w;
  const hy = (ctx.here - hx) / s.w;
  // The sim only kicks from the tile center: the bot first walks there (away from any escape).
  const center = moverAtTile(s, ctx.here, ctx.mover.speed);
  let fallbackOk: boolean | undefined;
  for (const dir of ALL_DIRS) {
    const bx = hx + DIR_DX[dir];
    const by = hy + DIR_DY[dir];
    const b = balloonAt(s, bx, by);
    if (!b || b.slideDir !== Dir.None || (b.passMask & (1 << ctx.slot)) !== 0) continue;
    const kickTick = kickTickFor(ctx, dir);
    if (kickTick === Infinity || !ctx.exact.isDryBetween(ctx.here, ctx.tick + 1, kickTick + 1)) continue;
    fallbackOk ??= survivesFailedKick(ctx, center);
    if (!fallbackOk) return null;
    const slide = projectKick(ctx, bx, by, dir, ctx.exact.burstTickOf(b.id), kickTick);
    if (!slide) continue;
    const hypo = ctx.exact.withKick(b.id, slide.path, slide.enter, slide.burstTick);
    const blocked = ctx.blocked.slice();
    blocked[idx(s.w, bx, by)] = 0;
    blocked[slide.path[slide.path.length - 1]] = 1;
    const mine = searchReach({
      danger: hypo,
      blocked,
      mover: center,
      startTick: kickTick,
      campUntil: campUntil(ctx, kickTick),
      horizon: kickTick + SEARCH_HORIZON,
      margin: SAFETY_MARGIN,
      stopAfter: 1,
    });
    if (mine.campTiles.length === 0) continue;
    const threat = threatOf(ctx, hypo, null, blocked);
    if (threat.trapped || threat.score >= 2.5) return { dir, balloonId: b.id };
  }
  return null;
}
