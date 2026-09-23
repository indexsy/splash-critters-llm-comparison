// Reachability searches from where the bot stands: the plain one (for danger checks and
// escapes) and the one used to pick goals, which keeps the bot off its own splash lines.
import { BLOCK_LEAD_TICKS, SAFETY_MARGIN, SEARCH_HORIZON, campUntil, opponentTicks, type BotContext } from './context';
import { withExtraWater, type DangerMap } from './dangerMap';
import { hijackTick, lobbedSplashes } from './hijack';
import { searchReach, type Loiter, type Reach } from './pathing';

/** Reachability from where the bot stands (perceived danger unless told otherwise). */
export function searchFromHere(ctx: BotContext, danger: DangerMap = ctx.view, margin = SAFETY_MARGIN, blocked = ctx.blocked): Reach {
  return searchReach({
    danger,
    blocked,
    mover: ctx.mover,
    startTick: ctx.tick,
    campUntil: campUntil(ctx, ctx.tick),
    horizon: ctx.tick + SEARCH_HORIZON,
    margin,
  });
}

/**
 * Longest (ticks) a careful bot plans to stand still on a tile a pending cascade of its own will
 * wet. Waiting there for another splash to drain hands opponents the time to seal it in (or to
 * set its cascade off early); a way out that does not wait there is taken whenever there is one.
 */
const OWN_LINE_WAIT_TICKS = 16;

/**
 * Reachability searches from where the bot stands for re-planning an escape, safest first, for
 * careful bots with a balloon of their own pending (none otherwise): clear of whatever revenge
 * ducks could lob into the bot's cascades (see lobbedSplashes) and with no long wait on its own
 * splash lines (see OWN_LINE_WAIT_TICKS); then only the former (when ducks are about). Each one
 * runs only when asked for.
 */
export function escapeSearches(ctx: BotContext): (() => Reach)[] {
  if (ctx.difficulty === 'easy') return [];
  const own = ctx.exact.tilesWetBy(ctx.slot);
  if (own.length === 0) return [];
  const lobbed = lobbedSplashes(ctx, ctx.view);
  const danger = withExtraWater(ctx.view, lobbed);
  const tiles = new Uint8Array(ctx.s.w * ctx.s.h);
  for (const t of own) tiles[t] = 1;
  const search = (loiter?: Loiter): Reach =>
    searchReach({
      danger,
      blocked: ctx.blocked,
      mover: ctx.mover,
      startTick: ctx.tick,
      campUntil: campUntil(ctx, ctx.tick),
      horizon: ctx.tick + SEARCH_HORIZON,
      margin: SAFETY_MARGIN,
      loiter,
    });
  const brisk = (): Reach => search({ tiles, maxTicks: OWN_LINE_WAIT_TICKS });
  return lobbed.size > 0 ? [brisk, () => search()] : [brisk];
}

/** Where the bot may go next: the reachability plus a check that a goal's route is safe to take. */
export interface GoalSearch {
  reach: Reach;
  /** Is the route to `tile` (with `first`, into its earliest dry window: see Reach.routeTo) safe to take? */
  routeOk: (tile: number, first?: boolean) => boolean;
}

/**
 * Reachability for choosing goals. Walking back across one's own splash lines is legal on timing,
 * yet an opponent can chain that balloon early or seal the way out at any moment. Every bot
 * assumes each own balloon bursts as early as an opponent could force it (see hijackTick). Careful
 * bots in a crowd (two or more opponents) never route through their own splash lines at all; in a
 * duel they may, but only along stretches no opponent could block before they are through.
 */
export function searchForGoals(ctx: BotContext): GoalSearch {
  const own = new Set(ctx.exact.tilesWetBy(ctx.slot));
  own.delete(ctx.here);
  const careful = ctx.difficulty !== 'easy';
  const view = hijackAwareView(ctx);
  if (careful && own.size > 0 && ctx.opponents.length >= 2) {
    const blocked = ctx.blocked.slice();
    for (const t of own) blocked[t] = 1;
    return { reach: searchFromHere(ctx, view, SAFETY_MARGIN, blocked), routeOk: () => true };
  }
  const reach = searchFromHere(ctx, view);
  if (!careful || own.size === 0) return { reach, routeOk: () => true };
  const opp = opponentTicks(ctx);
  return { reach, routeOk: (tile, first = false) => !sealableInOwnSplash(reach, tile, own, opp, first) };
}

/** The perceived map with each of the bot's balloons bursting at its earliest forceable tick. */
function hijackAwareView(ctx: BotContext): DangerMap {
  const earlier = new Map<number, number>();
  for (const b of ctx.s.balloons) {
    if (b.owner !== ctx.slot || b.fromDuck) continue;
    const own = ctx.exact.burstTickOf(b.id);
    const forced = hijackTick(ctx, ctx.exact, b.ty * ctx.s.w + b.tx, own);
    if (forced < own) earlier.set(b.id, forced);
  }
  return earlier.size === 0 ? ctx.view : ctx.view.withEarlierBursts(earlier);
}

/** Could an opponent drop a balloon in the bot's way while the route runs through its own splash? */
function sealableInOwnSplash(reach: Reach, target: number, own: ReadonlySet<number>, opp: Float64Array, first: boolean): boolean {
  if (reach.anyAt[target] === Infinity) return true;
  return reach.routeHas(target, (to, cross, from) => (own.has(to) || own.has(from)) && opp[to] <= cross - BLOCK_LEAD_TICKS, first);
}
