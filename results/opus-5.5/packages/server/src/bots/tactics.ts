// Goal selection: every candidate destination must be campable (safe to stand on through every
// pending burst). Candidates are power-ups, farming spots next to castles, attack spots (Medium
// and Hard) and, failing those, hunting or wandering. Drop goals are verified before they are
// chosen, and the current goal is kept unless a new one is clearly better (hysteresis). A chosen
// attack or farming spot is kept for a moment even when its option flickers (it is re-judged on
// arrival), so two bots eyeing each other do not dance back and forth; wander targets expire.
import { CONFIG, PowerUp, hashSeed, speedTilesPerSec } from '@splash/shared';
import { CHAIN_SPOT_LINGER, attackRadius, crossOf, findAttackOptions, kickerNear, nearestOpponentDistance, type Threat } from './attack';
import { canDropOn, tileDistance, type BotContext } from './context';
import { MAX_ATTACK_REPEATS, attackKey, attackWanted, farmValue, isEarlyGame, isLateGame } from './drops';
import { planDropEscape } from './escape';
import { digTargets } from './hunt';
import { moverAtTile } from './motion';
import type { Reach } from './pathing';

export type GoalKind = 'farm' | 'item' | 'attack' | 'hunt' | 'wander';

/** Attack spots considered: those reachable within this many ticks... */
const HARD_ATTACK_WINDOW = 75;
const MEDIUM_ATTACK_WINDOW = 35;
/** ...of which at most this many (best first) get a full threat evaluation. */
const HARD_ATTACK_EVALS = 8;
const MEDIUM_ATTACK_EVALS = 2;

export interface Goal {
  tile: number;
  kind: GoalKind;
  value: number;
  /** Drop a balloon on arrival. */
  drop: boolean;
  /** Tick the goal was chosen. */
  since: number;
  /** The goal tile only has to stay dry until this tick (a chain spot: see attack.ts); Infinity = campable. */
  until: number;
}

/** Per-bot memory that survives between decisions. */
export interface GoalMemory {
  /** Tiles whose drop could not be verified, excluded as drop goals until the given tick. */
  blacklist: Map<number, number>;
  /** Per-round salt for this bot's stable per-tile taste (Easy's sloppy preferences). */
  salt: number;
  /** No hunting before this tick (set when the bot got stuck shadowing an opponent it cannot hurt). */
  huntPausedUntil: number;
  /** Attack balloons already dropped this round, by drop tile and where the opponents stood (see attackKey). */
  attacks: Map<string, number>;
}

/** How often this very attack was made already this round. */
export function attackRepeats(ctx: BotContext, memory: GoalMemory, tile: number): number {
  return memory.attacks.get(attackKey(ctx, tile)) ?? 0;
}

function huntPaused(ctx: BotContext, memory: GoalMemory): boolean {
  return ctx.tick < memory.huntPausedUntil;
}

interface Weights {
  farm: number;
  item: number;
  attack: number;
  hunt: number;
  /** Stable per-tile +-fraction applied to scores (Easy is sloppy). */
  noise: number;
}

/** Keep the current goal unless a candidate beats it by this factor. */
const SWITCH_FACTOR = 1.35;
/** Arrival time (ticks) at which a goal's score is halved. */
const TIME_SCALE = 40;
const MAX_DROP_VERIFICATIONS = 3;
/**
 * An attack or farming spot stays the goal this long (ticks) after it was chosen, even if its
 * option flickers (a target stepping out of line, an opponent with Boots passing by the spot):
 * the drop is judged again on arrival anyway.
 */
const DROP_COMMIT_TICKS = 45;
/** A wander target not reached within this many ticks is replaced. */
const WANDER_TICKS = 90;
/** Ticks a failed drop spot is excluded from drop goals. */
export const BLACKLIST_TICKS = 30;

function makeGoal(ctx: BotContext, tile: number, kind: GoalKind, value: number, drop: boolean, until = Infinity): Goal {
  return { tile, kind, value, drop, since: ctx.tick, until };
}

/** A chain spot (see attack.ts) is walked to in its first dry window, every other goal in its campable one. */
function isChainSpot(goal: Goal): boolean {
  return goal.until !== Infinity;
}

function blacklisted(ctx: BotContext, memory: GoalMemory, tile: number): boolean {
  return (memory.blacklist.get(tile) ?? -1) > ctx.tick;
}

/** Hard's priorities by phase: power-ups early, a balanced middle, the hunt late. */
function hardWeights(ctx: BotContext): Weights {
  if (isEarlyGame(ctx)) return { farm: 1.1, item: 1.8, attack: 0.6, hunt: 0.15, noise: 0 };
  if (isLateGame(ctx)) return { farm: 0.4, item: 0.8, attack: 2.5, hunt: 2, noise: 0 };
  return { farm: 0.6, item: 1.2, attack: 2, hunt: 1.5, noise: 0 };
}

function weightsFor(ctx: BotContext): Weights {
  switch (ctx.difficulty) {
    case 'easy':
      return { farm: 1, item: 1, attack: 0, hunt: 0, noise: 0.5 };
    case 'medium':
      return { farm: 1, item: 1.2, attack: 1, hunt: 0.25, noise: 0.15 };
    default:
      return hardWeights(ctx);
  }
}

interface Candidate {
  goal: Goal;
  score: number;
}

/**
 * Value discounted by arrival time. Sloppiness is a stable per-tile taste (not fresh noise each
 * decision), so a sloppy bot does not flip-flop between goals.
 */
function score(ctx: BotContext, arrival: number, value: number, tile: number, w: Weights, memory: GoalMemory): number {
  const dt = Math.max(0, arrival - ctx.tick);
  const taste = w.noise > 0 ? 1 + ((hashSeed(memory.salt, tile) / 0x100000000) * 2 - 1) * w.noise : 1;
  return (value * taste) / (1 + dt / TIME_SCALE);
}

/** How much a power-up is worth to this bot right now (always > 0: grabbing it denies opponents). */
function itemValue(ctx: BotContext, kind: number): number {
  const me = ctx.me;
  switch (kind) {
    case PowerUp.Balloon:
      return me.maxBalloons < CONFIG.BALLOONS_CAP ? 2.5 : 0.3;
    case PowerUp.Range:
      return me.range < CONFIG.RANGE_CAP ? 2.5 : 0.3;
    case PowerUp.Speed:
      return speedTilesPerSec(me.speedUps) < CONFIG.SPEED_CAP ? 2 : 0.3;
    case PowerUp.Boots:
      return me.canKick ? 0.3 : ctx.difficulty === 'hard' ? 2 : 1;
    default:
      return 0;
  }
}

function itemCandidates(ctx: BotContext, reach: Reach, w: Weights, memory: GoalMemory, out: Candidate[]): void {
  for (const tile of reach.campTiles) {
    const kind = ctx.s.items[tile];
    if (kind === PowerUp.None) continue;
    const value = itemValue(ctx, kind) * w.item;
    out.push({ goal: makeGoal(ctx, tile, 'item', value, false), score: score(ctx, reach.campAt[tile], value, tile, w, memory) });
  }
}

/** Extra value (times the hunt weight) of a farming spot that washes a castle walling off the prey. */
const DIG_VALUE = 2;

function farmCandidates(ctx: BotContext, reach: Reach, w: Weights, memory: GoalMemory, out: Candidate[]): void {
  const dig = w.hunt > 0 && !huntPaused(ctx, memory) ? digTargets(ctx) : null;
  for (const tile of reach.campTiles) {
    // The current tile was already judged by decideDropHere this decision.
    if (tile === ctx.here || blacklisted(ctx, memory, tile) || !canDropOn(ctx, tile)) continue;
    if (ctx.difficulty !== 'easy' && kickerNear(ctx, tile)) continue;
    const castles = farmValue(ctx, tile);
    if (castles < 1) continue;
    const digs = dig !== null && dig.size > 0 && crossOf(ctx, tile).some((t) => dig.has(t));
    const value = castles * w.farm + (digs ? DIG_VALUE * w.hunt : 0);
    out.push({ goal: makeGoal(ctx, tile, 'farm', value, true), score: score(ctx, reach.campAt[tile], value, tile, w, memory) });
  }
}

function attackCandidates(ctx: BotContext, reach: Reach, w: Weights, memory: GoalMemory, out: Candidate[]): void {
  const hard = ctx.difficulty === 'hard';
  if (!hard && ctx.difficulty !== 'medium') return;
  if (!hard && (nearestOpponentDistance(ctx) > attackRadius(ctx) || ctx.rng() >= ctx.tuning.aggression)) return;
  // Only spots elsewhere whose balloon would be dropped on arrival (the bar decideDropHere applies).
  const wants = { tile: (t: number) => t !== ctx.here && !blacklisted(ctx, memory, t), threat: (t: Threat) => attackWanted(ctx, t) };
  const window = hard ? HARD_ATTACK_WINDOW : MEDIUM_ATTACK_WINDOW;
  const evaluations = hard ? HARD_ATTACK_EVALS : MEDIUM_ATTACK_EVALS;
  for (const o of findAttackOptions(ctx, reach, window, evaluations, wants)) {
    const repeats = attackRepeats(ctx, memory, o.tile);
    if (repeats >= MAX_ATTACK_REPEATS && !o.threat.trapped) continue;
    const value = (o.threat.score * w.attack) / (1 + repeats);
    const until = o.chain ? o.arrival + CHAIN_SPOT_LINGER : Infinity;
    out.push({ goal: makeGoal(ctx, o.tile, 'attack', value, true, until), score: score(ctx, o.arrival, value, o.tile, w, memory) });
  }
}

/**
 * Hunting: the campable tile closest to an opponent (Medium/Hard, when nothing better exists),
 * unless the bot has paused hunting (see GoalMemory.huntPausedUntil).
 */
function huntCandidate(ctx: BotContext, reach: Reach, w: Weights, memory: GoalMemory, out: Candidate[]): void {
  if (w.hunt <= 0 || ctx.opponents.length === 0 || huntPaused(ctx, memory)) return;
  let best = -1;
  let bestKey = Infinity;
  for (const tile of reach.campTiles) {
    const d = nearestOpponentDistance(ctx, tile);
    const key = d * 100 + (reach.campAt[tile] - ctx.tick);
    if (d >= 1 && key < bestKey) {
      bestKey = key;
      best = tile;
    }
  }
  if (best < 0 || best === ctx.here) return;
  const value = 0.5 * w.hunt;
  out.push({ goal: makeGoal(ctx, best, 'hunt', value, false), score: score(ctx, reach.campAt[best], value, best, w, memory) });
}

/**
 * A random campable tile a few steps away: keeps idle bots moving and exploring. `minTiles`:
 * prefer tiles at least this far (Manhattan) from where the bot stands.
 */
export function wanderGoal(ctx: BotContext, reach: Reach, routeOk: (tile: number) => boolean, minTiles = 1): Goal | null {
  const near = reach.campTiles.filter((t) => t !== ctx.here && reach.campAt[t] <= ctx.tick + 60 && routeOk(t));
  const far = near.filter((t) => tileDistance(ctx.s.w, t, ctx.here) >= minTiles);
  const options = far.length > 0 ? far : near;
  if (options.length === 0) return null;
  const tile = options[Math.floor(ctx.rng() * options.length)];
  return makeGoal(ctx, tile, 'wander', 0.05, false);
}

/**
 * Re-scores the current goal against the fresh reach; null when it is no longer worth pursuing.
 * A goal missing from the fresh candidates keeps its old value while it is still being committed
 * to: hunts until reached, attack and farming spots for DROP_COMMIT_TICKS, wanders for
 * WANDER_TICKS.
 */
function rescoreCurrent(ctx: BotContext, reach: Reach, current: Goal, all: Candidate[]): Candidate | null {
  const same = all.find((c) => c.goal.tile === current.tile && c.goal.kind === current.kind);
  if (same) return { goal: { ...same.goal, since: current.since }, score: same.score };
  // A chain spot is only ever walked to while it still works.
  if (isChainSpot(current) || reach.campAt[current.tile] === Infinity || current.tile === ctx.here) return null;
  const age = ctx.tick - current.since;
  const committed =
    current.kind === 'hunt' ||
    ((current.kind === 'attack' || current.kind === 'farm') && age < DROP_COMMIT_TICKS) ||
    (current.kind === 'wander' && age < WANDER_TICKS);
  if (!committed) return null;
  return { goal: current, score: current.value / (1 + (reach.campAt[current.tile] - ctx.tick) / TIME_SCALE) };
}

/**
 * Drops the drop goals whose escape cannot be verified (blacklisting them for a while). Only the
 * best few are checked, plus the current goal, so that it can be kept (hysteresis): otherwise a
 * current goal that ranks just below the checked few would be abandoned for one that ranks above
 * it only from where the bot stands now, and the bot could shuttle between the two.
 */
function verifyDropGoals(ctx: BotContext, reach: Reach, sorted: Candidate[], memory: GoalMemory, current: Goal | null): Candidate[] {
  const kept: Candidate[] = [];
  let checks = 0;
  for (const c of sorted) {
    if (!c.goal.drop || c.goal.kind === 'attack') {
      kept.push(c);
      continue;
    }
    const isCurrent = current !== null && c.goal.tile === current.tile && c.goal.kind === current.kind;
    if (!isCurrent && checks >= MAX_DROP_VERIFICATIONS) continue;
    if (!isCurrent) checks++;
    const tile = c.goal.tile;
    const arrival = Math.max(reach.campAt[tile], ctx.tick);
    if (planDropEscape(ctx, tile, moverAtTile(ctx.s, tile, ctx.mover.speed), arrival + 1)) kept.push(c);
    else memory.blacklist.set(tile, ctx.tick + BLACKLIST_TICKS);
  }
  return kept;
}

/**
 * Picks where to go next among goals whose route passes `routeOk`. Returns null when nothing is
 * worth doing (the caller may wander).
 */
export function chooseGoal(
  ctx: BotContext,
  reach: Reach,
  current: Goal | null,
  memory: GoalMemory,
  routeOk: (tile: number, first?: boolean) => boolean,
): Goal | null {
  const w = weightsFor(ctx);
  const all: Candidate[] = [];
  // A passive (tutorial) bot only wanders and flees: it leaves power-ups to the player.
  if (!ctx.passive) {
    itemCandidates(ctx, reach, w, memory, all);
    farmCandidates(ctx, reach, w, memory, all);
    attackCandidates(ctx, reach, w, memory, all);
    huntCandidate(ctx, reach, w, memory, all);
  }
  all.sort((a, b) => b.score - a.score);
  const verified = verifyDropGoals(ctx, reach, all, memory, current).filter((c) => routeOk(c.goal.tile, isChainSpot(c.goal)));
  const best = verified[0] ?? null;
  const keep = current !== null && routeOk(current.tile, isChainSpot(current)) && !(current.kind === 'hunt' && huntPaused(ctx, memory));
  const kept = keep ? rescoreCurrent(ctx, reach, current, verified) : null;
  if (kept && (!best || kept.score * SWITCH_FACTOR >= best.score)) return kept.goal;
  return best ? best.goal : null;
}
