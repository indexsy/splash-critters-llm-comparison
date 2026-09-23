// Getting out of the water: escape verification for a balloon the bot is about to drop (always
// against the exact danger map, chains included), refuge selection when the current tile is
// doomed, and a last-resort "survive as long as possible" route when nothing is safe.
import { CONFIG, activeBalloonCount, playerBoxOverlapsTile, speedUnitsPerTick, type PlayerState } from '@splash/shared';
import {
  BLOCK_LEAD_TICKS,
  CAMP_HORIZON,
  SAFETY_MARGIN,
  SEARCH_HORIZON,
  campUntil,
  canDropOn,
  opponentTicks,
  unblockedUntil,
  type BotContext,
} from './context';
import { eitherFuture, withExtraWater, type DangerMap, type WetWindows } from './dangerMap';
import { hijackTick, lobbedSplashes } from './hijack';
import { playerTileIndex } from './motion';
import { searchReach, type Mover, type Reach, type Route } from './pathing';
import { searchFromHere } from './reach';

export interface Escape {
  route: Route;
  target: number;
  /**
   * The target only has to stay dry until this tick (exclusive), when that is sooner than a
   * campable tile's usual horizon: a sudden-death refuge that floods right after the round is
   * decided, or the longest-dry tile when nothing is campable. Omitted = campable as usual.
   */
  until?: number;
  /** Nothing campable was reachable: the target is only the tile that stays dry the longest (see planSurvival). */
  lastResort?: boolean;
}

/** Where and when a balloon of ours lands. */
export interface Drop {
  tile: number;
  placeTick: number;
}

/** The exact danger map plus a balloon of ours placed on `tile` during `placeTick` (chains included). */
export function dropHypothesis(ctx: BotContext, tile: number, placeTick: number): DangerMap {
  const tx = tile % ctx.s.w;
  return ctx.exact.withBalloon(tx, (tile - tx) / ctx.s.w, ctx.me.range, ctx.slot, placeTick + CONFIG.FUSE_TICKS);
}

/**
 * A drop hypothesis (see dropHypothesis) as opponent `o` faces it: the new balloon blocks its tile
 * only from the placement until it bursts, so the opponent may still cross the tile before then;
 * an opponent standing on the tile as it lands may walk off it (the sim lets it through).
 */
export function facedBy(ctx: BotContext, hypo: DangerMap, drop: Drop, o: PlayerState): DangerMap {
  if (drop.placeTick === ctx.tick + 1 && mayStandOnDrop(ctx, drop.tile, o)) return hypo;
  return hypo.withOccupied(drop.tile, drop.placeTick, hypo.burstTickOf(hypo.nextBalloonId));
}

/**
 * Could `o` be standing on (overlapping) `tile` when our balloon lands there next tick? It does
 * now, or it acts before us within the tick (players act in slot order) and is one step away.
 */
function mayStandOnDrop(ctx: BotContext, tile: number, o: PlayerState): boolean {
  const tx = tile % ctx.s.w;
  const ty = (tile - tx) / ctx.s.w;
  if (playerBoxOverlapsTile(o, tx, ty)) return true;
  if (o.slot > ctx.slot) return false;
  const half = CONFIG.PLAYER_HALF + speedUnitsPerTick(o.speedUps);
  const x0 = tx * CONFIG.SUB;
  const y0 = ty * CONFIG.SUB;
  return o.x + half > x0 && o.x - half < x0 + CONFIG.SUB && o.y + half > y0 && o.y - half < y0 + CONFIG.SUB;
}

/**
 * Would a balloon placed on `tile` during `placeTick` still let the bot reach a campable tile in
 * time (budgeting against the chain-effective burst, not the raw fuse)? Returns the best escape
 * or null. Movement is assumed to resume only after the placement tick.
 */
export function planDropEscape(ctx: BotContext, tile: number, mover: Mover, placeTick: number): Escape | null {
  return escapeUnder(ctx, dropHypothesis(ctx, tile, placeTick), tile, mover, placeTick);
}

/** A balloon an opponent could still drop where it stands in answer to ours (before it is soaked). */
export interface RevengeDrop {
  tile: number;
  slot: number;
  range: number;
}

/** The revenge balloons the given opponents could drop right where they stand (`shot` = our drop tile). */
export function revengeDrops(ctx: BotContext, slots: readonly number[], shot: number): RevengeDrop[] {
  const drops: RevengeDrop[] = [];
  for (const slot of slots) {
    const o = ctx.s.players[slot];
    const tile = playerTileIndex(ctx.s, o);
    if (tile === shot || !canDropOn(ctx, tile) || activeBalloonCount(ctx.s, slot) >= o.maxBalloons) continue;
    drops.push({ tile, slot, range: o.range });
  }
  return drops;
}

/** `danger` plus the revenge balloons, dropped in answer to ours (placed during `placeTick`). */
export function withRevenge(danger: DangerMap, drops: readonly RevengeDrop[], placeTick: number): DangerMap {
  let out = danger;
  for (const d of drops) {
    const tx = d.tile % out.w;
    out = out.withBalloon(tx, (d.tile - tx) / out.w, d.range, d.slot, placeTick + 1 + CONFIG.FUSE_TICKS);
  }
  return out;
}

/**
 * A drop hypothesis (the latest balloon of `hypo`, ours, on `tile`) as careful bots budget it: that
 * balloon bursting as early as an opponent could force it by chaining into it (see hijackTick).
 * Easy bots take the fuse at face value. `hypo` must be the exact map plus that one balloon (and
 * whatever the caller added before it, which the rebuilt map keeps).
 */
export function hijackBudgeted(ctx: BotContext, hypo: DangerMap, tile: number, placeTick: number): DangerMap {
  if (ctx.difficulty === 'easy') return hypo;
  const own = hypo.burstTickOf(hypo.nextBalloonId);
  const forced = hijackTick(ctx, hypo, tile, own);
  if (forced >= own) return hypo;
  const tx = tile % ctx.s.w;
  return hypo.withoutLatest().withBalloon(tx, (tile - tx) / ctx.s.w, ctx.me.range, ctx.slot, Math.max(forced, placeTick + 1));
}

/** The context with some opponents left out of the careful checks (their caches rebuilt without them). */
function withoutOpponents(ctx: BotContext, slots: readonly number[]): BotContext {
  const opponents = ctx.opponents.filter((o) => !slots.includes(o.slot));
  return { ...ctx, opponents, oppTicks: undefined, enterBy: undefined, basePressure: undefined };
}

/**
 * Escape search under an already built drop hypothesis (see dropHypothesis). Careful bots budget
 * against the earliest burst an opponent could force by chaining into the new balloon.
 * `trapped`: the opponents the balloon traps (a kill shot). They can no longer reach anything
 * before they are soaked, so the careful checks (contested routes, pocket refuges, hijacked
 * fuses) only weigh the other opponents; instead, what a trapped opponent can still do, drop a
 * revenge balloon where it stands (it chains with ours), is weighed too: the way out must hold
 * whether or not that happens (the answer can also set things off earlier and so open a way out
 * that is not there without it). Careful bots also keep clear of what revenge ducks could lob
 * into the new cascade (see lobbedSplashes) and of routes an opponent could block first. In the
 * tide's end game (nothing stays dry for long anyway) a careful bot's kill shot refuge only has to
 * stay dry through the burst: the round ends right there.
 */
export function escapeUnder(
  ctx: BotContext,
  hypo: DangerMap,
  tile: number,
  mover: Mover,
  placeTick: number,
  trapped: readonly number[] = [],
): Escape | null {
  const killShot = trapped.length > 0;
  const guard = killShot ? withoutOpponents(ctx, trapped) : ctx;
  const revenge = killShot ? revengeDrops(ctx, trapped, tile) : [];
  const blocked = ctx.blocked.slice();
  blocked[tile] = 1;
  for (const r of revenge) blocked[r.tile] = 1;
  const own = hypo.burstTickOf(hypo.nextBalloonId);
  const base = hijackBudgeted(guard, hypo, tile, placeTick);
  // The way out must hold whether or not the trapped opponents answer (see withRevenge), and for
  // careful bots whatever revenge ducks lob into the new cascade (see lobbedSplashes).
  const answered = revenge.length > 0 ? eitherFuture(base, withRevenge(base, revenge, placeTick)) : base;
  const danger = ctx.difficulty === 'easy' ? answered : withExtraWater(answered, lobbedSplashes(ctx, base));
  // The refuge must at least outlast the new balloon's own splash, except for an end-game kill.
  const normal = campUntil(ctx, placeTick);
  const endgame = normal < placeTick + CAMP_HORIZON;
  const suddenDeath = killShot && endgame && ctx.difficulty !== 'easy';
  const safeUntil = suddenDeath ? own + 1 : Math.max(normal, own + CONFIG.SPLASH_TICKS + 1);
  const reach = searchReach({
    danger,
    blocked,
    mover,
    startTick: placeTick,
    campUntil: safeUntil,
    horizon: placeTick + SEARCH_HORIZON,
    margin: SAFETY_MARGIN,
    stopAfter: ctx.difficulty === 'easy' ? 6 : 0,
    // Careful bots never bet their own balloon on a route an opponent could block first...
    enterBy: ctx.difficulty === 'easy' || guard.opponents.length === 0 ? undefined : unblockedUntil(guard),
  });
  // ...nor on a pocket that one more balloon could seal.
  const target = bestRefuge(guard, reach, tile, danger);
  if (target < 0) return null;
  const route = reach.routeTo(target);
  if (!route) return null;
  return safeUntil < normal ? { route, target, until: safeUntil } : { route, target };
}

/** The best campable tile to run to right now whose route passes `routeOk`, or null if none is reachable. */
export function planRefuge(ctx: BotContext, reach: Reach, routeOk: (tile: number) => boolean = () => true): Escape | null {
  const target = bestRefuge(ctx, reach, -1, null, routeOk);
  if (target < 0) return null;
  const route = reach.routeTo(target);
  return route ? { route, target } : null;
}

/** Mid-escape the refuge was lost: take the quickest way out of the water, nothing fancier. */
export function planQuickestRefuge(reach: Reach): Escape | null {
  let target = -1;
  for (const tile of reach.campTiles) if (target < 0 || reach.campAt[tile] < reach.campAt[target]) target = tile;
  if (target < 0) return null;
  const route = reach.routeTo(target);
  return route ? { route, target } : null;
}

/**
 * Nothing is campable: stay dry as long as possible (tide end game or a hopeless corner). The
 * search knows the latest tick any reachable dry window lasts until, over every window of every
 * tile, not just the first one the bot could step into (a tile may only be worth it after a splash
 * on the way has drained); searching again with that as the camping horizon routes to the
 * earliest-reached tile whose window lasts that long.
 */
export function planSurvival(ctx: BotContext): Escape | null {
  const reach = searchFromHere(ctx, ctx.exact, 0);
  const safe = planRefuge(ctx, reach);
  if (safe) return safe;
  const until = reach.lastDry;
  if (until <= ctx.tick + 1) return null;
  const longest = searchReach({
    danger: ctx.exact,
    blocked: ctx.blocked,
    mover: ctx.mover,
    startTick: ctx.tick,
    campUntil: until,
    horizon: ctx.tick + SEARCH_HORIZON,
    margin: 0,
    stopAfter: 1,
  });
  const target = longest.campTiles[0];
  if (target === undefined) return null;
  const route = longest.routeTo(target);
  return route ? { route, target, until, lastResort: true } : null;
}

/**
 * Ranks campable tiles by arrival time plus penalties: routes an opponent could block by standing
 * on them first (dropping a balloon there would seal the bot in with its own splash), dead ends
 * while opponents are around, and tiles right next to an opponent. `strict` (the drop hypothesis,
 * for careful bots' drop escapes) excludes contested routes and pocket refuges outright.
 */
function bestRefuge(
  ctx: BotContext,
  reach: Reach,
  exclude: number,
  strict: WetWindows | null,
  routeOk: (tile: number) => boolean = () => true,
): number {
  const careful = ctx.difficulty !== 'easy';
  const opp = ctx.opponents.length > 0 ? opponentTicks(ctx) : undefined;
  let best = -1;
  let bestScore = Infinity;
  for (const tile of reach.campTiles) {
    if (tile === exclude || !routeOk(tile)) continue;
    const contested = careful && opp !== undefined && isContested(reach, tile, opp);
    if (contested && strict) continue;
    if (strict && careful) {
      const close = opp !== undefined && opp[tile] <= reach.campAt[tile] + CLOSE_OPPONENT_TICKS;
      const need = close ? MIN_REFUGE_ROOM_CONTESTED : MIN_REFUGE_ROOM;
      if (refugeRoom(ctx, strict, reach.startTick, tile, need) < need) continue;
    }
    let score = reach.campAt[tile] - reach.startTick;
    if (opp) {
      if (contested) score += 45;
      if (opp[tile] <= reach.campAt[tile] + 8) score += 10;
      if (openNeighbours(ctx, tile) <= 1) score += 6;
    }
    if (score < bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

/** A drop refuge must open onto at least this many dry tiles (more when opponents are close). */
const MIN_REFUGE_ROOM = 3;
const MIN_REFUGE_ROOM_CONTESTED = 7;
/** Opponents able to reach the refuge within this many ticks of the bot count as close. */
const CLOSE_OPPONENT_TICKS = 60;

/**
 * Size (capped at `need`) of the open patch around a refuge: tiles reachable from it without
 * entering a blocked tile or water pending in `danger`. A small patch is a pocket that one more
 * opponent balloon could seal while the bot's own splash closes the other side.
 */
function refugeRoom(ctx: BotContext, danger: WetWindows, from: number, tile: number, need: number): number {
  const { w, h } = ctx.s;
  const until = campUntil(ctx, from);
  const seen = new Set([tile]);
  const queue = [tile];
  const visit = (n: number): void => {
    if (seen.has(n) || ctx.blocked[n] === 1 || !danger.isDryBetween(n, from, until)) return;
    seen.add(n);
    queue.push(n);
  };
  for (let head = 0; head < queue.length && seen.size < need; head++) {
    const t = queue[head];
    const x = t % w;
    if (t >= w) visit(t - w);
    if (t + w < w * h) visit(t + w);
    if (x > 0) visit(t - 1);
    if (x < w - 1) visit(t + 1);
  }
  return seen.size;
}

/** True if an opponent could drop a balloon on some tile of the route before the bot gets there. */
function isContested(reach: Reach, target: number, opp: Float64Array): boolean {
  if (reach.anyAt[target] === Infinity) return true;
  return reach.routeHas(target, (to, cross) => opp[to] <= cross - BLOCK_LEAD_TICKS);
}

function openNeighbours(ctx: BotContext, tile: number): number {
  const { w, h } = ctx.s;
  const x = tile % w;
  const open = (n: number): number => (ctx.blocked[n] === 0 ? 1 : 0);
  return (tile >= w ? open(tile - w) : 0) + (tile + w < w * h ? open(tile + w) : 0) + (x > 0 ? open(tile - 1) : 0) + (x < w - 1 ? open(tile + 1) : 0);
}
