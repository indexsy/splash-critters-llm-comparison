// Setup-and-seal combos (Hard): a balloon that makes an opponent run is worth far more when a
// second one, dropped on the bot's own way out, shuts the opponent in where it runs to. The
// opponent is expected to take its quickest way to safety (what careful players and bots do);
// the seal is judged from where that puts it when the second balloon lands, reacting perfectly
// from then on. The bot's way from the first drop over the seal tile must hold with or without
// the seal, so a wrong guess only costs a balloon: the drop is judged again on the seal tile.
import { ALL_DIRS, CONFIG, DIR_DX, DIR_DY, Tile, activeBalloonCount } from '@splash/shared';
import { BLOCK_LEAD_TICKS, SAFETY_MARGIN, SEARCH_HORIZON, campUntil, canDropOn, opponentTicks, tileDistance, type BotContext } from './context';
import type { DangerMap } from './dangerMap';
import { escapeUnder, facedBy, hijackBudgeted, type Drop, type Escape } from './escape';
import { moverAtTile, moverOf, playerTileIndex } from './motion';
import { searchReach, type Reach, type Route } from './pathing';

/** The second balloon must land within this many ticks of the first. */
const SEAL_WINDOW = 45;
/** Seal tiles checked per opponent (earliest first). */
const MAX_SEALS = 6;
/** Opponents farther than this (tiles, Manhattan) from the first balloon are not considered. */
const COMBO_REACH = 6;

export interface Combo {
  /** Tile of the sealing balloon. */
  seal: number;
  victim: number;
  /** From the first drop over the seal tile on to a refuge (the way out if the seal is not dropped). */
  escape: Escape;
}

/** Where a mover following `route` is on tick `t` (its last tile once it got there). */
function tileAt(route: Route, t: number): number {
  let k = 0;
  while (k + 1 < route.tiles.length && route.cross[k + 1] <= t) k++;
  return route.tiles[k];
}

/** Tiles from which a balloon of `range` reaches `target` in a straight line (target included), nearest first. */
function sealTiles(ctx: BotContext, target: number, range: number, obstacle: number): number[] {
  const { s } = ctx;
  const out = [target];
  const tx = target % s.w;
  const ty = (target - tx) / s.w;
  for (const dir of ALL_DIRS) {
    for (let k = 1; k <= range; k++) {
      const x = tx + DIR_DX[dir] * k;
      const y = ty + DIR_DY[dir] * k;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) break;
      const t = y * s.w + x;
      if (s.tiles[t] !== Tile.Floor || t === obstacle || ctx.blocked[t] === 1) break;
      out.push(t);
    }
  }
  return out;
}

/**
 * Could an opponent shut the bot in its own first balloon's splash on the way to the seal? Where it
 * could get to a tile of the way in the bot's own splash lines (`own`) first and drop a balloon
 * there, the bot, stopped one tile short, must still have another way out.
 */
function waySealable(ctx: BotContext, route: Route, own: ReadonlySet<number>, base1: DangerMap, blocked1: Uint8Array): boolean {
  const opp = opponentTicks(ctx);
  for (let k = 1; k < route.tiles.length; k++) {
    const to = route.tiles[k];
    const from = route.tiles[k - 1];
    if (!(own.has(to) || own.has(from)) || opp[to] > route.cross[k] - BLOCK_LEAD_TICKS) continue;
    const blocked = blocked1.slice();
    blocked[to] = 1;
    const out = searchReach({
      danger: base1,
      blocked,
      mover: moverAtTile(ctx.s, from, ctx.mover.speed),
      startTick: route.cross[k - 1],
      campUntil: campUntil(ctx, route.cross[k - 1]),
      horizon: route.cross[k - 1] + SEARCH_HORIZON,
      margin: SAFETY_MARGIN,
      stopAfter: 1,
    });
    if (out.campTiles.length === 0) return true;
  }
  return false;
}

/**
 * A seal for the first drop `drop1` (the exact map plus it: `hypo1`), or null. Only for bots with
 * a second balloon to spare. The returned escape leads over the seal tile to a refuge.
 */
export function planCombo(ctx: BotContext, hypo1: DangerMap, drop1: Drop): Combo | null {
  const { s, me } = ctx;
  if (activeBalloonCount(s, ctx.slot) + 2 > me.maxBalloons) return null;
  const base1 = hijackBudgeted(ctx, hypo1, drop1.tile, drop1.placeTick);
  const blocked1 = ctx.blocked.slice();
  blocked1[drop1.tile] = 1;
  const mover1 = drop1.tile === ctx.here ? ctx.mover : moverAtTile(s, drop1.tile, ctx.mover.speed);
  let mine: Reach | null = null;
  for (const o of ctx.opponents) {
    const ot = playerTileIndex(s, o);
    if (tileDistance(s.w, ot, drop1.tile) > COMBO_REACH) continue;
    const run = searchReach({
      danger: facedBy(ctx, hypo1, drop1, o),
      blocked: ctx.blocked,
      mover: moverOf(o),
      startTick: ctx.tick,
      campUntil: campUntil(ctx, ctx.tick),
      horizon: ctx.tick + SEARCH_HORIZON,
      margin: 0,
      stopAfter: 1,
    });
    // Nothing to exploit if it need not move; already trapped is the plain threat's business.
    if (run.startCampable || run.campTiles.length === 0) continue;
    const refuge = run.campTiles[0];
    const flight = run.routeTo(refuge);
    if (!flight) continue;
    mine ??= searchReach({
      danger: base1,
      blocked: blocked1,
      mover: mover1,
      startTick: drop1.placeTick,
      campUntil: Infinity,
      horizon: drop1.placeTick + SEAL_WINDOW,
      margin: SAFETY_MARGIN,
    });
    const combo = sealFor(ctx, { hypo1, base1, blocked1, drop1, mine }, o.slot, flight, refuge);
    if (combo) return combo;
  }
  return null;
}

interface Setup {
  hypo1: DangerMap;
  base1: DangerMap;
  blocked1: Uint8Array;
  drop1: Drop;
  /** The bot's reach after the first drop. */
  mine: Reach;
}

/**
 * The earliest seal tile that traps the opponent, whether it holds its ground until the seal lands
 * (a careless or slow player, the tutorial partner) or runs along `flight` at once, and still
 * lets the bot out.
 */
function sealFor(ctx: BotContext, setup: Setup, victim: number, flight: Route, refuge: number): Combo | null {
  const { s, me } = ctx;
  const { hypo1, base1, blocked1, drop1, mine } = setup;
  const o = s.players[victim];
  const stand = playerTileIndex(s, o);
  const candidates = [...new Set([...sealTiles(ctx, stand, me.range, drop1.tile), ...sealTiles(ctx, refuge, me.range, drop1.tile)])]
    .filter((t) => mine.anyAt[t] !== Infinity && canDropOn(ctx, t))
    .sort((a, b) => mine.anyAt[a] - mine.anyAt[b])
    .slice(0, MAX_SEALS);
  for (const seal of candidates) {
    const placeTick = Math.ceil(mine.anyAt[seal]) + 1;
    if (!base1.isDryBetween(seal, placeTick - 1, placeTick + 1)) continue;
    const sx = seal % s.w;
    const hypo2 = hypo1.withBalloon(sx, (seal - sx) / s.w, me.range, ctx.slot, placeTick + CONFIG.FUSE_TICKS);
    const drop2 = { tile: seal, placeTick };
    const traps = (from: number): boolean => trapsFrom(ctx, hypo2, drop2, o.slot, from, blocked1, drop1.tile);
    if (!traps(stand) && !traps(tileAt(flight, placeTick))) continue;
    const toSeal = mine.routeTo(seal);
    if (!toSeal || waySealable(ctx, toSeal, new Set(base1.tilesWetBy(ctx.slot)), base1, blocked1)) continue;
    const sealer = { ...ctx, blocked: blocked1 };
    const mover = moverAtTile(s, seal, ctx.mover.speed);
    // With the seal dropped the bot must get away as from any kill shot...
    if (!escapeUnder(sealer, hypo2, seal, mover, placeTick, [victim])) continue;
    // ...and without it (the opponent went elsewhere) it keeps running from the first balloon.
    const onward = searchReach({
      danger: base1,
      blocked: blocked1,
      mover,
      startTick: placeTick,
      campUntil: campUntil(ctx, placeTick),
      horizon: placeTick + SEARCH_HORIZON,
      margin: SAFETY_MARGIN,
      stopAfter: 1,
    });
    const target = onward.campTiles[0];
    const rest = target === undefined ? null : onward.routeTo(target);
    if (!rest) continue;
    const route: Route = {
      tiles: [...toSeal.tiles, ...rest.tiles.slice(1)],
      cross: [...toSeal.cross, ...rest.cross.slice(1)],
    };
    return { seal, victim, escape: { route, target } };
  }
  return null;
}

/** Would the balloon `drop` (the latest of `hypo`) leave opponent `slot`, standing on `from` as it lands, no way out? */
function trapsFrom(ctx: BotContext, hypo: DangerMap, drop: Drop, slot: number, from: number, blocked1: Uint8Array, first: number): boolean {
  const o = ctx.s.players[slot];
  const blocked = from === first ? ctx.blocked : blocked1;
  const danger = from === drop.tile ? hypo : hypo.withOccupied(drop.tile, drop.placeTick, hypo.burstTickOf(hypo.nextBalloonId));
  const reach = searchReach({
    danger,
    blocked,
    mover: moverAtTile(ctx.s, from, moverOf(o).speed),
    startTick: drop.placeTick,
    campUntil: campUntil(ctx, drop.placeTick),
    horizon: drop.placeTick + SEARCH_HORIZON,
    margin: 0,
    stopAfter: 1,
  });
  return reach.campTiles.length === 0;
}
