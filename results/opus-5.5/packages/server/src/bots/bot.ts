// Server-side bot brain. Every tick, before simulateTick, the game loop asks each bot for its
// input. A bot re-decides every `decisionMs` (in ticks) and otherwise follows its current plan
// tick by tick; it re-plans early when the plan breaks. Decision order: keep escaping until the
// current tile is safe; drop a balloon here if worth it and escapable; kick (Hard); flee if the
// current tile is doomed; otherwise go for the best campable goal, hold or wander.
import {
  CONFIG,
  Dir,
  hashSeed,
  mulberry32,
  type BotTuning,
  type Difficulty,
  type DirCode,
  type PlayerInput,
  type PlayerState,
  type RoundState,
} from '@splash/shared';
import { nearestOpponentDistance } from './attack';
import { CAMP_HORIZON, campUntil, makeContext, tileDistance, type BotContext } from './context';
import { getDangerMap } from './dangerMap';
import { attackKey, decideDropHere } from './drops';
import { duckAction } from './duck';
import { planQuickestRefuge, planRefuge, planSurvival } from './escape';
import { KICK_TICKS, findKick } from './kick';
import { predictStep, tileIndex, wouldKick } from './motion';
import type { Reach } from './pathing';
import { escapeSearches, searchForGoals, searchFromHere, type GoalSearch } from './reach';
import { dodge, escapePlan, kickTargetWaiting, makePlan, steer, type Plan, type SteerResult } from './steer';
import { BLACKLIST_TICKS, attackRepeats, chooseGoal, wanderGoal, type GoalMemory } from './tactics';

export interface BotBrain {
  readonly slot: number;
  readonly difficulty: Difficulty;
  /** Called once per sim tick BEFORE simulateTick; returns this tick's input. */
  nextInput(state: RoundState): PlayerInput;
  /** Called at each round start. */
  reset(): void;
}

export interface BotOptions {
  /**
   * Tutorial sparring partner: never places balloons or takes power-ups. It strolls around while
   * nothing is going on, stands its ground while a player is near, and flees a splash only
   * PASSIVE_REACTION_TICKS before it lands, so a new player can catch it in a few tries.
   */
  passive?: boolean;
}

export function createBot(slot: number, difficulty: Difficulty, seed: number, opts: BotOptions = {}): BotBrain {
  return new SplashBot(slot, difficulty, seed, opts.passive === true);
}

/** Holding still this long (ticks) with nothing to do makes the bot wander. */
const IDLE_WANDER_TICKS: Record<Difficulty, number> = { easy: 15, medium: 30, hard: 30 };
/** A passive bot stands around this long between strolls (it is there to be caught)... */
const PASSIVE_IDLE_TICKS = 75;
/** ...and only strolls while no balloon is waiting and every opponent is at least this far away (tiles). */
const PASSIVE_CALM_DISTANCE = 4;
/**
 * A bot that has neither dropped a balloon nor got STUCK_TILES tiles away from where it was for
 * STUCK_TICKS is stuck (typically shadowing an opponent it cannot hurt): it stops hunting for
 * HUNT_PAUSE_TICKS and roams at least ROAM_TILES away.
 */
const STUCK_TICKS = 150;
const STUCK_TILES = 2;
const HUNT_PAUSE_TICKS = 120;
const ROAM_TILES = 3;
/**
 * Hard gives up a committed refuge for the quickest one when that is this many ticks sooner: a
 * long detour or wait (often inside its own splash lines) is worse than switching.
 */
const REROUTE_SLACK_TICKS = 8;
/** A misjudging decision believes others' splashes come this many ticks later (plus up to MISJUDGE_SPREAD). */
const MISJUDGE_MIN = 10;
const MISJUDGE_SPREAD = 16;
/**
 * A passive bot only starts running from a balloon this many ticks before it bursts (a beginner's
 * balloon dropped right next to it then catches it every few tries), but then at once. It does so
 * by seeing other players' splashes late by just enough to find its tile campable until then.
 */
const PASSIVE_REACTION_TICKS = 12;
const PASSIVE_REACTION_DELAY = CAMP_HORIZON - PASSIVE_REACTION_TICKS;

class SplashBot implements BotBrain {
  private seq = 0;
  private round = 0;
  private rng!: () => number;
  private plan: Plan | null = null;
  private nextDecision = 0;
  private misjudgeDelay = 0;
  private dropNow = false;
  private holdSince = 0;
  /** Where the bot last made progress (tile index) and when (see STUCK_TICKS). */
  private anchor = -1;
  private anchorTick = 0;
  private memory!: GoalMemory;
  private readonly tuning: BotTuning;
  private readonly decisionTicks: number;

  constructor(
    readonly slot: number,
    readonly difficulty: Difficulty,
    private readonly seed: number,
    private readonly passive: boolean,
  ) {
    this.tuning = CONFIG.BOTS[difficulty];
    this.decisionTicks = Math.max(1, Math.round(this.tuning.decisionMs / CONFIG.TICK_MS));
    this.reset();
  }

  reset(): void {
    this.round++;
    this.rng = mulberry32(hashSeed(this.seed, this.slot, this.round));
    this.plan = null;
    this.nextDecision = 0;
    this.misjudgeDelay = 0;
    this.dropNow = false;
    this.holdSince = 0;
    this.anchor = -1;
    this.anchorTick = 0;
    this.memory = { blacklist: new Map(), salt: hashSeed(this.seed, this.slot, this.round, 0x5a17), huntPausedUntil: 0, attacks: new Map() };
  }

  nextInput(s: RoundState): PlayerInput {
    this.seq++;
    const me = s.players[this.slot];
    if (!me || !me.present || s.over) return this.emit(Dir.None, false);
    if (!me.alive) return this.rideDuck(s, me);
    const due = this.plan === null || s.tick >= this.nextDecision;
    if (due) this.rollPerception();
    const ctx = this.context(s);
    this.noteProgress(ctx);
    if (due || this.startled(ctx) || this.cornered()) this.decide(ctx);
    let step = this.follow(ctx);
    if (!step.ok) {
      this.decide(ctx);
      step = this.follow(ctx);
    }
    let dir = dodge(ctx, step.ok ? step.dir : Dir.None);
    // Only a chosen kick may push a balloon; any other press into one would kick it by accident.
    const kicking = this.plan?.kind === 'kick' && dir === this.plan.kickDir;
    if (!kicking && wouldKick(s, me, dir)) dir = Dir.None;
    return this.withDrop(ctx, dir);
  }

  private emit(dir: DirCode, balloon: boolean): PlayerInput {
    return { seq: this.seq, dir, balloon };
  }

  /** Easy sometimes believes other players' splashes come later than they will; a passive bot always does. */
  private rollPerception(): void {
    if (this.passive) {
      this.misjudgeDelay = PASSIVE_REACTION_DELAY;
      return;
    }
    const misjudges = this.tuning.misjudgeChance > 0 && this.rng() < this.tuning.misjudgeChance;
    this.misjudgeDelay = misjudges ? MISJUDGE_MIN + Math.floor(this.rng() * MISJUDGE_SPREAD) : 0;
  }

  private context(s: RoundState): BotContext {
    const exact = getDangerMap(s);
    return makeContext({
      s,
      slot: this.slot,
      tuning: this.tuning,
      difficulty: this.difficulty,
      passive: this.passive,
      rng: this.rng,
      exact,
      view: this.misjudgeDelay > 0 ? exact.perceivedBy(this.slot, this.misjudgeDelay) : exact,
    });
  }

  /**
   * On a last-resort escape (nothing campable was in reach) careful bots look for a way out again
   * on every tick: one may open for just a tick or two (a balloon in the way bursts, a splash
   * drains, a kicked balloon stops short of the corridor).
   */
  private cornered(): boolean {
    return this.plan?.lastResort === true && this.difficulty !== 'easy';
  }

  /** A passive bot reacts late but at once: it re-decides the moment its tile turns doomed in its view. */
  private startled(ctx: BotContext): boolean {
    if (!this.passive || this.plan?.kind === 'escape') return false;
    return !ctx.view.isDryBetween(ctx.here, ctx.tick + 1, ctx.tick + 1 + CAMP_HORIZON);
  }

  private follow(ctx: BotContext): SteerResult {
    return this.plan ? steer(ctx, this.plan) : { ok: true, dir: Dir.None };
  }

  private rideDuck(s: RoundState, me: PlayerState): PlayerInput {
    const decide = s.tick >= this.nextDecision;
    if (decide) this.nextDecision = s.tick + this.decisionTicks;
    const action = duckAction(s, me, this.difficulty, this.rng, decide);
    return this.emit(action.dir, action.lob && !this.passive);
  }

  /** Emits the input; on a drop tick the balloon must land on the tile the escape was planned from. */
  private withDrop(ctx: BotContext, dir: DirCode): PlayerInput {
    if (!this.dropNow) return this.emit(dir, false);
    this.dropNow = false;
    if (ctx.exact.isWetAt(ctx.here, ctx.tick + 1)) return this.emit(dir, false);
    const pos = predictStep(ctx.s, ctx.me, dir);
    const stays = tileIndex(ctx.s, pos.x, pos.y) === ctx.here;
    this.anchorTick = ctx.tick;
    return this.emit(stays ? dir : Dir.None, true);
  }

  /** Progress: getting STUCK_TILES away from the anchor (dropping a balloon counts too, see withDrop). */
  private noteProgress(ctx: BotContext): void {
    if (this.anchor >= 0 && tileDistance(ctx.s.w, ctx.here, this.anchor) < STUCK_TILES) return;
    this.anchor = ctx.here;
    this.anchorTick = ctx.tick;
  }

  /** Stuck for STUCK_TICKS: pause hunting and start the clock again (the bot is sent roaming). */
  private stuck(ctx: BotContext): boolean {
    if (ctx.tick - this.anchorTick < STUCK_TICKS) return false;
    this.anchorTick = ctx.tick;
    this.memory.huntPausedUntil = ctx.tick + HUNT_PAUSE_TICKS;
    return true;
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  private decide(ctx: BotContext): void {
    this.nextDecision = ctx.tick + this.decisionTicks;
    this.dropNow = false;
    if (this.kickInProgress(ctx)) return;
    const reach = searchFromHere(ctx);
    if (this.plan?.kind === 'escape' && !reach.startCampable) {
      // Committed to the escape; only Medium/Hard may add a verified attack balloon on the way.
      if (this.difficulty !== 'easy' && this.tryDrop(ctx, true)) return;
      this.setPlan(ctx, this.continueEscape(ctx, reach));
      return;
    }
    if (this.tryDrop(ctx, false)) return;
    if (!this.passive && this.difficulty === 'hard' && this.tryKick(ctx)) return;
    // Goals are always chosen through the guarded search, also (above all) when the current tile
    // is doomed: a destination is only ever a campable tile whose route keeps off the bot's own
    // splash lines wherever an opponent could seal them. With no such goal, the bot flees.
    this.setPlan(ctx, this.pickDestination(ctx, searchForGoals(ctx), reach));
  }

  /**
   * The current tile will get wet: commit to the best refuge, preferring routes the guarded search
   * accepts, then any refuge, then the tile that stays dry the longest.
   */
  private flee(ctx: BotContext, guarded: GoalSearch, plain: Reach): Plan {
    const refuge = planRefuge(ctx, guarded.reach, guarded.routeOk) ?? planRefuge(ctx, plain) ?? planSurvival(ctx);
    return refuge ? escapePlan(refuge) : this.hold(ctx);
  }

  private setPlan(ctx: BotContext, plan: Plan): void {
    if (plan.kind !== 'hold' || this.plan?.kind !== 'hold') this.holdSince = ctx.tick;
    this.plan = plan;
  }

  private hold(ctx: BotContext): Plan {
    return makePlan('hold', { tiles: [ctx.here], cross: [ctx.tick] });
  }

  private tryDrop(ctx: BotContext, escaping: boolean): boolean {
    if (this.passive) return false;
    const goal = escaping ? null : (this.plan?.goal ?? null);
    const atGoal = goal !== null && goal.drop && goal.tile === ctx.here;
    const repeats = attackRepeats(ctx, this.memory, ctx.here);
    const drop = decideDropHere(ctx, { committed: atGoal && goal.kind === 'attack', attackOnly: escaping, repeats });
    if (!drop) {
      // Walked here to drop but it no longer works: do not come straight back.
      if (atGoal) {
        this.memory.blacklist.set(ctx.here, ctx.tick + BLACKLIST_TICKS);
        if (this.plan) this.plan.goal = null;
      }
      return false;
    }
    if (drop.attack) this.memory.attacks.set(attackKey(ctx, ctx.here), repeats + 1);
    this.setPlan(ctx, escapePlan(drop.escape));
    this.dropNow = true;
    return true;
  }

  private tryKick(ctx: BotContext): boolean {
    const kick = findKick(ctx);
    if (!kick) return false;
    const plan = this.hold(ctx);
    plan.kind = 'kick';
    plan.kickDir = kick.dir;
    plan.kickUntil = ctx.tick + KICK_TICKS;
    plan.kickBalloon = kick.balloonId;
    this.setPlan(ctx, plan);
    return true;
  }

  /** A kick keeps the bot pressing until the balloon slides, the attempt times out or new danger shows up. */
  private kickInProgress(ctx: BotContext): boolean {
    const plan = this.plan;
    if (!plan || !kickTargetWaiting(ctx, plan)) return false;
    return ctx.view.isDryBetween(ctx.here, ctx.tick + 1, plan.kickUntil + 1);
  }

  /**
   * Keep running along the escape route while it still works and still ends on a campable tile
   * (another just as quick way out would otherwise win by a hair from each new position and the
   * bot would dither between the two). Else re-plan: to the committed refuge while it is still
   * campable (Hard: and not much further off than the quickest one, see REROUTE_SLACK_TICKS),
   * else to the quickest refuge, careful bots first on the safest terms (see escapeSearches);
   * failing all that, to the tile that stays dry the longest. A refuge stops being campable when
   * new water is due there (say, an opponent's balloon chained into the bot's own cascade): the
   * bot must not run into it. A last-resort escape is never kept as it is: a real way out is
   * looked for again every time.
   */
  private continueEscape(ctx: BotContext, reach: Reach): Plan {
    const plan = this.plan;
    if (plan && plan.kind === 'escape' && !plan.lastResort && this.escapeHolds(ctx, plan)) return plan;
    const target = plan ? plan.route.tiles[plan.route.tiles.length - 1] : -1;
    for (const search of [...escapeSearches(ctx), () => reach]) {
      const options = search();
      const quickest = planQuickestRefuge(options);
      if (!quickest) continue;
      const slack = this.difficulty === 'hard' ? REROUTE_SLACK_TICKS : Infinity;
      const committed = target >= 0 && options.campAt[target] <= options.campAt[quickest.target] + slack;
      const again = committed ? options.routeTo(target) : null;
      return again ? makePlan('escape', again) : escapePlan(quickest);
    }
    const refuge = planSurvival(ctx);
    return refuge ? escapePlan(refuge) : this.hold(ctx);
  }

  /**
   * The escape still leads somewhere safe: its refuge stays dry long enough (a refuge that only
   * has to last until plan.until, a sudden-death one, is held to that until the tick comes) and
   * the route can still be followed. Easy does not look again at where it is running to (one of
   * its sloppy habits).
   */
  private escapeHolds(ctx: BotContext, plan: Plan): boolean {
    const { tiles, cross } = plan.route;
    const arrival = Math.max(cross[cross.length - 1], ctx.tick + 1);
    const horizon = campUntil(ctx, ctx.tick);
    const until = plan.until > arrival ? Math.min(plan.until, horizon) : horizon;
    const refugeHolds = this.difficulty === 'easy' || ctx.view.isDryBetween(tiles[tiles.length - 1], arrival, until);
    return refugeHolds && steer(ctx, plan).ok;
  }

  /** How long the bot holds still before wandering (a passive bot stands its ground while anything is going on). */
  private idleTicks(ctx: BotContext): number {
    if (!this.passive) return IDLE_WANDER_TICKS[this.difficulty];
    const calm = ctx.s.balloons.length === 0 && nearestOpponentDistance(ctx) >= PASSIVE_CALM_DISTANCE;
    return calm ? PASSIVE_IDLE_TICKS : Infinity;
  }

  /**
   * The best guarded goal (or a wander when idle or stuck); flees when the current tile is doomed
   * and nothing is worth going for.
   */
  private pickDestination(ctx: BotContext, guarded: GoalSearch, plain: Reach): Plan {
    const { reach, routeOk } = guarded;
    const doomed = !plain.startCampable || !reach.startCampable;
    // The passive tutorial bot stands its ground on purpose.
    const stuck = !doomed && !this.passive && this.stuck(ctx);
    const current = this.plan?.kind === 'go' ? this.plan.goal : null;
    let goal = chooseGoal(ctx, reach, current, this.memory, routeOk);
    const idle = this.plan?.kind === 'hold' && ctx.tick - this.holdSince >= this.idleTicks(ctx);
    // chooseGoal keeps a live wander target; one that expired or became unreachable is replaced.
    const wandering = current?.kind === 'wander' && current.tile !== ctx.here;
    if (stuck && goal?.kind !== 'wander') goal = wanderGoal(ctx, reach, routeOk, ROAM_TILES) ?? goal;
    else if (!goal && !doomed && (idle || wandering)) goal = wanderGoal(ctx, reach, routeOk);
    if (goal) {
      // A chain spot is walked to in its first dry window, before the water it waits for comes.
      const route = reach.routeTo(goal.tile, goal.until !== Infinity);
      if (route) return makePlan('go', route, goal, goal.until);
    }
    return doomed ? this.flee(ctx, guarded, plain) : this.hold(ctx);
  }
}
