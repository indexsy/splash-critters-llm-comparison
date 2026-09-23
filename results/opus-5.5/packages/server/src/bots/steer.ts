// Executing a plan tick by tick: press toward the next tile of the route, never cross into a tile
// earlier than it is dry for the planned stay, ask for a re-plan when the bot drifts off the route,
// falls behind schedule or would not move, and dodge at the last moment if standing still (or the
// chosen step) would get the bot soaked on the next tick.
import { ALL_DIRS, DIR_DX, DIR_DY, Dir, isSolidFor, type DirCode } from '@splash/shared';
import { campUntil, type BotContext } from './context';
import type { Escape } from './escape';
import { centeringDir, dirBetween, predictStep, slideTargetFree, tileIndex } from './motion';
import type { Route } from './pathing';
import type { Goal } from './tactics';

export type PlanKind = 'go' | 'escape' | 'hold' | 'kick';

export interface Plan {
  kind: PlanKind;
  route: Route;
  /** Index into route.tiles of the tile the bot is on. */
  step: number;
  goal: Goal | null;
  /** Kick plans: press this way until the balloon slides (or the deadline passes). */
  kickDir: DirCode;
  kickUntil: number;
  kickBalloon: number;
  /** The last tile only has to stay dry until this tick (see Escape.until); Infinity = campable as usual. */
  until: number;
  /** An escape to the tile that stays dry the longest, nothing campable being in reach (see Escape.lastResort). */
  lastResort: boolean;
}

export function makePlan(kind: PlanKind, route: Route, goal: Goal | null = null, until = Infinity): Plan {
  return { kind, route, step: 0, goal, kickDir: Dir.None, kickUntil: 0, kickBalloon: -1, until, lastResort: false };
}

/** The plan that runs along an escape's route. */
export function escapePlan(escape: Escape): Plan {
  const plan = makePlan('escape', escape.route, null, escape.until);
  plan.lastResort = escape.lastResort === true;
  return plan;
}

/** The balloon a kick plan aims at still rests where it was when the kick was chosen, with room to slide. */
export function kickTargetWaiting(ctx: BotContext, plan: Plan): boolean {
  if (plan.kind !== 'kick' || ctx.tick >= plan.kickUntil) return false;
  const b = ctx.s.balloons.find((x) => x.id === plan.kickBalloon);
  return b !== undefined && b.slideDir === Dir.None && slideTargetFree(ctx.s, b.tx + DIR_DX[plan.kickDir], b.ty + DIR_DY[plan.kickDir]);
}

export type SteerResult = { ok: true; dir: DirCode } | { ok: false; reason: string };

/** Ticks behind the planned crossing after which the schedule is considered broken. */
const LATE_TOLERANCE = 2;
/** At the end of its route the bot re-plans at once if its tile turns wet within this many ticks. */
const THREAT_REFLEX_TICKS = 30;

/**
 * Until when the last tile of `plan`, reached on tick `from`, must stay dry for the plan to hold:
 * an escape's refuge for as long as it has to be campable (as the search that found it and the
 * bot's later checks ask, see campUntil), any other end tile THREAT_REFLEX_TICKS; less for a plan
 * whose end tile only has to last until plan.until (once that tick is here, the plan has served
 * its purpose and is judged like any other).
 */
function endDryUntil(ctx: BotContext, plan: Plan, from: number): number {
  const usual = plan.kind === 'escape' ? Math.max(campUntil(ctx, ctx.tick), from + 1) : from + THREAT_REFLEX_TICKS;
  return plan.until > from ? Math.min(usual, plan.until) : usual;
}

/**
 * New danger (a balloon dropped, lobbed or kicked since the plan was made) floods a tile of the
 * rest of the route while the plan has the bot on it (the end tile: within THREAT_REFLEX_TICKS of
 * getting there; an escape's refuge: before it stops being campable): re-plan at once rather than
 * at the next decision, when it may be too late (a step further on, the way back may be shut).
 * The bot is on tiles[k] from tick cross[k] until it crosses into the next tile on tick
 * cross[k + 1] (moves come before bursts within a tick, so that tile only has to be dry until then).
 */
function threatened(ctx: BotContext, plan: Plan, step: number): boolean {
  if (plan.kind === 'kick') return false;
  const { tiles, cross } = plan.route;
  for (let k = step; k < tiles.length; k++) {
    const from = k === step ? ctx.tick + 1 : Math.max(cross[k], ctx.tick + 1);
    const until = k + 1 < tiles.length ? cross[k + 1] : endDryUntil(ctx, plan, from);
    if (!ctx.view.isDryBetween(tiles[k], from, Math.max(until, from + 1))) return true;
  }
  return false;
}

function atEnd(ctx: BotContext, plan: Plan): SteerResult {
  if (plan.kind === 'kick') {
    // Stop pressing the moment the balloon slides: never follow it into its own splash.
    return kickTargetWaiting(ctx, plan) ? { ok: true, dir: plan.kickDir } : { ok: false, reason: 'kick-done' };
  }
  const wantsDrop = plan.goal !== null && plan.goal.drop;
  return { ok: true, dir: wantsDrop ? Dir.None : centeringDir(ctx.me) };
}

/** The direction to press this tick to follow `plan` (advancing plan.step), or why it cannot be followed. */
export function steer(ctx: BotContext, plan: Plan): SteerResult {
  const { tiles, cross } = plan.route;
  const w = ctx.s.w;
  let step = plan.step;
  while (step + 1 < tiles.length && tiles[step] !== ctx.here && tiles[step + 1] === ctx.here) step++;
  if (tiles[step] !== ctx.here) return { ok: false, reason: 'off-route' };
  plan.step = step;
  if (threatened(ctx, plan, step)) return { ok: false, reason: 'threatened' };
  // Hard: a balloon (or castle) appeared further along the route, re-plan now while the way back
  // may still be open (an opponent sealing the corridor ahead); the others notice it only once
  // they walk up to it.
  if (ctx.difficulty === 'hard') {
    for (let k = step + 2; k < tiles.length; k++) if (ctx.blocked[tiles[k]] === 1) return { ok: false, reason: 'blocked' };
  }
  if (step === tiles.length - 1) return atEnd(ctx, plan);
  const next = tiles[step + 1];
  const dir = dirBetween(w, tiles[step], next);
  if (dir === Dir.None) return { ok: false, reason: 'broken-route' };
  // A balloon or castle appeared on the route: re-plan instead of pressing into it (that would
  // also kick the balloon by accident when wearing Boots).
  const nx = next % w;
  if (isSolidFor(ctx.s, ctx.slot, nx, (next - nx) / w)) return { ok: false, reason: 'blocked' };
  if (ctx.tick + 1 > cross[step + 1] + LATE_TOLERANCE) return { ok: false, reason: 'late' };
  const pos = predictStep(ctx.s, ctx.me, dir);
  if (pos.x === ctx.me.x && pos.y === ctx.me.y) return { ok: false, reason: 'stuck' };
  if (tileIndex(ctx.s, pos.x, pos.y) === ctx.here) return { ok: true, dir };
  // Crossing into `next` on the coming tick: it must stay dry from now until the planned exit (the
  // goal tile: until its planned entry, from which the search already knows it stays dry).
  const leave = step + 2 < tiles.length ? cross[step + 2] : cross[step + 1] + 1;
  if (!ctx.view.isDryBetween(next, ctx.tick + 1, Math.max(leave, ctx.tick + 2))) return { ok: true, dir: Dir.None };
  return { ok: true, dir };
}

/**
 * Last-moment reflex: if the chosen input leaves the bot on a tile it believes is wet on the next
 * tick, pick the input whose resulting tile stays dry the longest. It uses the bot's own view, so
 * a misjudging Easy bot can still walk into a splash; everyone else sees the exact danger.
 */
export function dodge(ctx: BotContext, dir: DirCode): DirCode {
  const next = ctx.tick + 1;
  const view = ctx.view;
  const landing = (d: DirCode): number => {
    const pos = predictStep(ctx.s, ctx.me, d);
    return tileIndex(ctx.s, pos.x, pos.y);
  };
  if (!view.isWetAt(landing(dir), next)) return dir;
  let best = dir;
  let bestDry = -1;
  for (const d of [Dir.None, ...ALL_DIRS]) {
    const tile = landing(d);
    if (view.isWetAt(tile, next)) continue;
    const dry = view.firstWetFrom(tile, next);
    if (dry > bestDry) {
      bestDry = dry;
      best = d;
    }
  }
  return best;
}
