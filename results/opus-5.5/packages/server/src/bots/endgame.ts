// Tide end game (sudden death): once the rising tide floods the arena while a new balloon's splash
// would still be pending, "campable" loses its meaning (nothing stays dry for long) and the round
// goes to whoever stays dry the longest. Careful bots then drop a balloon whenever it makes an
// opponent run out of dry tiles strictly before they do (a survival race), which decides the
// sudden death instead of letting everyone drown together in a draw.
import { CONFIG } from '@splash/shared';
import { SAFETY_MARGIN, type BotContext } from './context';
import { eitherFuture, type DangerMap } from './dangerMap';
import { facedBy, revengeDrops, withRevenge, type Escape } from './escape';
import { moverOf } from './motion';
import { searchReach, type Mover } from './pathing';

/** The bot must stay dry at least this many ticks longer than the opponent it outlasts. */
const OUTLAST_TICKS = 3;

export interface EndgameShot {
  escape: Escape;
  /** Slots of the opponents the balloon makes run dry before the bot. */
  victims: number[];
}

/** Would a balloon placed during `placeTick` still be pending or splashing once the tide rises? */
export function inTideEndgame(ctx: BotContext, placeTick: number): boolean {
  const { rules } = ctx.s;
  return rules.tide && placeTick + CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS >= rules.tideStartTick;
}

/** The latest tick (exclusive) a mover starting at `from` can stay dry until, moving perfectly. */
function survivalTick(danger: DangerMap, blocked: Uint8Array, mover: Mover, from: number): number {
  return searchReach({ danger, blocked, mover, startTick: from, campUntil: Infinity, horizon: danger.lastFloodTick, margin: 0 }).lastDry;
}

/** How long a player (the bot or an opponent) can stay dry as things stand (cached per tick). */
function currentSurvival(ctx: BotContext, slot: number): number {
  const cache = ctx.survival ?? (ctx.survival = new Map());
  let v = cache.get(slot);
  if (v === undefined) {
    v = survivalTick(ctx.exact, ctx.blocked, moverOf(ctx.s.players[slot]), ctx.tick);
    cache.set(slot, v);
  }
  return v;
}

/**
 * Does a balloon on `tile` (the exact map plus that balloon: `hypo`), dropped during `placeTick`
 * with the bot then leaving as `mover`, win the survival race? It must cut some opponent's time
 * short. When it cuts every opponent short (a duel, or a clean sweep), the bot only has to stay
 * dry OUTLAST_TICKS longer than the last of them: the round is over by then. Otherwise the round
 * goes on, so the bot must also stay clear of its own splash and may not shorten its own time
 * below a survivor's (it would just trade places). The bot's way out must hold whether or not the
 * opponents answer with a balloon right where they stand (an answer can also set balloons off
 * earlier and so open a way out that is not there without it); opponents are assumed to dodge
 * perfectly, from now, knowing where the balloon lands (see facedBy). Returns the bot's way out (the quickest
 * tile that stays dry long enough) and the victims, or null.
 */
export function endgameShot(ctx: BotContext, hypo: DangerMap, tile: number, mover: Mover, placeTick: number): EndgameShot | null {
  const drop = { tile, placeTick };
  const victims: number[] = [];
  let firstVictimDry = Infinity;
  let lastVictimDry = -Infinity;
  let survivorsDry = -Infinity;
  for (const o of ctx.opponents) {
    const dry = survivalTick(facedBy(ctx, hypo, drop, o), ctx.blocked, moverOf(o), ctx.tick);
    if (dry >= currentSurvival(ctx, o.slot)) {
      survivorsDry = Math.max(survivorsDry, dry);
      continue;
    }
    victims.push(o.slot);
    firstVictimDry = Math.min(firstVictimDry, dry);
    lastVictimDry = Math.max(lastVictimDry, dry);
  }
  if (victims.length === 0) return null;
  const sweep = victims.length === ctx.opponents.length;
  const ownSplashOver = hypo.burstTickOf(hypo.nextBalloonId) + CONFIG.SPLASH_TICKS + 1;
  const blocked = ctx.blocked.slice();
  blocked[tile] = 1;
  const revenge = revengeDrops(ctx, ctx.opponents.map((o) => o.slot), tile);
  for (const r of revenge) blocked[r.tile] = 1;
  const until = sweep ? lastVictimDry + OUTLAST_TICKS : Math.max(firstVictimDry + OUTLAST_TICKS, ownSplashOver);
  const reach = searchReach({
    danger: revenge.length > 0 ? eitherFuture(hypo, withRevenge(hypo, revenge, placeTick)) : hypo,
    blocked,
    mover,
    startTick: placeTick,
    campUntil: until,
    horizon: hypo.lastFloodTick,
    margin: SAFETY_MARGIN,
  });
  if (reach.campTiles.length === 0) return null;
  if (!sweep && reach.lastDry < currentSurvival(ctx, ctx.slot) && reach.lastDry < survivorsDry + OUTLAST_TICKS) return null;
  const target = reach.campTiles[0];
  const route = reach.routeTo(target);
  // The refuge only has to hold until then (it may flood soon after): see Escape.until.
  return route ? { escape: { route, target, until }, victims } : null;
}
