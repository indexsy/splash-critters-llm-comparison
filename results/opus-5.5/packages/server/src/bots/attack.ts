// Offense: how much a hypothetical balloon hurts opponents (can they still reach a campable tile
// in time?), and which reachable tiles would let the bot trap or pressure them. Hard bots also
// aim at where a moving opponent is heading and at the corridors next to it.
import { CONFIG, DIR_DX, DIR_DY, Dir, idx, tileOf, type PlayerState } from '@splash/shared';
import { SEARCH_HORIZON, campUntil, canDropOn, tileDistance, type BotContext } from './context';
import type { DangerMap } from './dangerMap';
import { endgameShot, inTideEndgame } from './endgame';
import { dropHypothesis, escapeUnder, facedBy, type Drop, type Escape } from './escape';
import { moverAtTile, moverOf, neighbours, splashCross } from './motion';
import { searchReach, type Reach } from './pathing';

export interface Threat {
  /** 0 = harmless; > 1 forces someone to move; +TIGHT_SCORE per tight squeeze; >= 10 per trapped opponent. */
  score: number;
  trapped: boolean;
  /** Slots of the opponents the balloon would trap. */
  trappedSlots: number[];
  /** Hard: some opponent only gets away if it starts running within REACTION_TICKS. */
  tight: boolean;
}

export interface AttackOption {
  tile: number;
  arrival: number;
  threat: Threat;
  escape: Escape;
  /** A chain spot (see attackCandidates): the tile is not campable, it only has to stay dry for the drop. */
  chain: boolean;
}

const TRAPPED_SCORE = 10;
/** A squeeze an opponent survives only by reacting within REACTION_TICKS is worth this much (Hard). */
const TIGHT_SCORE = 4;
const REACTION_TICKS = 6;
/**
 * Hard: a splash the opponent needs longer than this to get out of (two tiles or more: it stands
 * in a corridor, or its short way out is closed) punishes any hesitation, so it is worth more.
 */
const DEEP_RUN_TICKS = 12;
const DEEP_SCORE = 1.5;
/** Opponents farther than this (tiles, Manhattan) from the balloon are not evaluated. */
const THREAT_REACH = 7;

function tileOfPlayer(ctx: BotContext, p: PlayerState): number {
  return tileOf(p.y) * ctx.s.w + tileOf(p.x);
}

/**
 * Pressure score of one opponent under a danger map, reacting from `from` (now by default) where
 * it stands: TRAPPED_SCORE when no refuge is reachable.
 */
function pressureOn(ctx: BotContext, danger: DangerMap, blocked: Uint8Array, o: PlayerState, from = ctx.tick): number {
  // Staying put is fine: no need to search (the search would find its start campable).
  if (danger.isDryBetween(tileOfPlayer(ctx, o), from + 1, campUntil(ctx, from))) return 0;
  const reach = searchReach({
    danger,
    blocked,
    mover: moverOf(o),
    startTick: from,
    campUntil: campUntil(ctx, from),
    horizon: from + SEARCH_HORIZON,
    margin: 0,
    stopAfter: 3,
  });
  if (reach.campTiles.length === 0) return TRAPPED_SCORE;
  if (reach.startCampable) return 0;
  const run = reach.campAt[reach.campTiles[0]] - from;
  const deep = ctx.tuning.predictive && run > DEEP_RUN_TICKS ? DEEP_SCORE : 0;
  return 1 + run / 30 + (3 - reach.campTiles.length) * 0.5 + deep;
}

/**
 * Hard: an opponent standing still where it is safe (it has no reason to move) is expected to be
 * there still when a balloon of ours lands later, and is judged from then on, not as if it knew
 * the balloon was coming. Wrong guesses cost nothing: the drop is judged again on arrival.
 */
function holdsStill(ctx: BotContext, o: PlayerState): boolean {
  return !o.moving && ctx.exact.isDryBetween(tileOfPlayer(ctx, o), ctx.tick + 1, campUntil(ctx, ctx.tick));
}

/**
 * Could `o` still get away from `danger` if it only started moving `delay` ticks from now? A
 * balloon that leaves an opponent less than a human reaction time (or a careless bot's next
 * look) to start running catches it more often than not.
 */
function getsAwayLate(ctx: BotContext, danger: DangerMap, blocked: Uint8Array, o: PlayerState, delay: number): boolean {
  const from = ctx.tick + delay;
  const reach = searchReach({
    danger,
    blocked,
    mover: moverOf(o),
    startTick: from,
    campUntil: campUntil(ctx, from),
    horizon: from + SEARCH_HORIZON,
    margin: 0,
    stopAfter: 1,
  });
  return reach.campTiles.length > 0;
}

/** Pressure each opponent is already under before the bot adds anything (cached per tick). */
function basePressure(ctx: BotContext, o: PlayerState): number {
  const cache = ctx.basePressure ?? (ctx.basePressure = new Map());
  let v = cache.get(o.slot);
  if (v === undefined) {
    v = pressureOn(ctx, ctx.exact, ctx.blocked, o);
    cache.set(o.slot, v);
  }
  return v;
}

/**
 * Extra pressure `hypo` puts on nearby opponents compared with the current danger, judged as if
 * they reacted from where they stand now, knowing everything: trapped if an opponent that had a
 * way out no longer reaches any campable tile in time; otherwise the longer their run and the
 * fewer their refuges, the higher the score. `drop`: the balloon of ours `hypo` adds (see
 * facedBy: it blocks its tile only once it lands); null for a kick, judged on `obstacles`.
 */
export function threatOf(ctx: BotContext, hypo: DangerMap, drop: Drop | null, obstacles = ctx.blocked): Threat {
  let score = 0;
  const trappedSlots: number[] = [];
  let tight = false;
  const later = drop !== null && drop.placeTick > ctx.tick + 1 && ctx.tuning.predictive;
  for (const o of ctx.opponents) {
    const ot = tileOfPlayer(ctx, o);
    if (tileDistance(ctx.s.w, ot, drop ? drop.tile : ctx.here) > ctx.me.range + THREAT_REACH) continue;
    const held = later && holdsStill(ctx, o);
    const base = held ? 0 : basePressure(ctx, o);
    if (base >= TRAPPED_SCORE) continue;
    const faced = drop ? facedBy(ctx, hypo, drop, o) : hypo;
    const now = pressureOn(ctx, faced, obstacles, o, held && drop ? drop.placeTick : ctx.tick);
    if (now >= TRAPPED_SCORE) trappedSlots.push(o.slot);
    else if (now > base && ctx.tuning.predictive && !getsAwayLate(
      ctx, faced, obstacles, o, REACTION_TICKS)) {
      tight = true;
      score += TIGHT_SCORE;
    }
    score += Math.max(0, now - base);
  }
  return { score, trapped: trappedSlots.length > 0, trappedSlots, tight };
}

/** Tiles worth splashing: each opponent's tile, plus (Hard) where it is heading and its exits. */
function targetTiles(ctx: BotContext): Set<number> {
  const targets = new Set<number>();
  const { s } = ctx;
  for (const o of ctx.opponents) {
    const ot = tileOfPlayer(ctx, o);
    targets.add(ot);
    if (!ctx.tuning.predictive) continue;
    if (o.moving && o.facing !== Dir.None) {
      const ahead = idx(s.w, tileOf(o.x) + DIR_DX[o.facing], tileOf(o.y) + DIR_DY[o.facing]);
      if (ctx.blocked[ahead] === 0) targets.add(ahead);
    }
    for (const n of neighbours(s.w, s.h, ot)) if (ctx.blocked[n] === 0) targets.add(n);
  }
  return targets;
}

/**
 * Hard: the way out of each opponent that has to move (its tile gets wet before it could camp
 * there): the tiles of its quickest escape route, refuge included. A balloon across that
 * corridor can shut it in with the water it is running from.
 */
function escapeCorridors(ctx: BotContext): Set<number> {
  const out = new Set<number>();
  const from = ctx.tick;
  for (const o of ctx.opponents) {
    if (ctx.exact.isDryBetween(tileOfPlayer(ctx, o), from + 1, campUntil(ctx, from))) continue;
    const reach = searchReach({
      danger: ctx.exact,
      blocked: ctx.blocked,
      mover: moverOf(o),
      startTick: from,
      campUntil: campUntil(ctx, from),
      horizon: from + SEARCH_HORIZON,
      margin: 0,
      stopAfter: 1,
    });
    const refuge = reach.campTiles[0];
    const route = refuge === undefined ? null : reach.routeTo(refuge);
    if (route) for (let k = 1; k < route.tiles.length; k++) out.add(route.tiles[k]);
  }
  return out;
}

/** Splash tiles of a balloon of ours on `tile` right now (cached for the tick). */
export function crossOf(ctx: BotContext, tile: number): readonly number[] {
  const cache = ctx.crosses ?? (ctx.crosses = new Map());
  let cross = cache.get(tile);
  if (cross === undefined) {
    cross = splashCross(ctx.s, tile, ctx.me.range);
    cache.set(tile, cross);
  }
  return cross;
}

interface Candidate {
  tile: number;
  arrival: number;
  /**
   * 3 = a chain spot; else 2 = splashes an opponent's tile (Hard: or the corridor it is escaping
   * along), 1 = chains into a waiting balloon, -1 = splashes no target.
   */
  rank: number;
  chain: boolean;
}

/** Ticks a chain spot must stay dry after the planned arrival (the drop comes on the next tick). */
export const CHAIN_SPOT_LINGER = 4;

/**
 * Reachable campable tiles within `maxTicks` worth a balloon: its splash would cover an opponent
 * (or, for Hard, its path/exits); in the tide end game any tile qualifies (a balloon can also
 * win the survival race by walling an opponent off). Most promising first.
 */
function attackCandidates(ctx: BotContext, reach: Reach, maxTicks: number): Candidate[] {
  const targets = targetTiles(ctx);
  const direct = new Set(ctx.opponents.map((o) => tileOfPlayer(ctx, o)));
  const corridors = ctx.tuning.predictive ? escapeCorridors(ctx) : new Set<number>();
  const balloons = new Set(ctx.s.balloons.map((b) => b.ty * ctx.s.w + b.tx));
  const endgame = inTideEndgame(ctx, ctx.tick + 1);
  const candidates: Candidate[] = [];
  for (const tile of reach.campTiles) {
    const arrival = reach.campAt[tile];
    if (arrival > ctx.tick + maxTicks || !canDropOn(ctx, tile) || kickerNear(ctx, tile)) continue;
    let hits = false;
    let rank = 0;
    for (const t of crossOf(ctx, tile)) {
      if (targets.has(t)) hits = true;
      if (direct.has(t)) rank |= 2;
      if (corridors.has(t)) {
        hits = true;
        rank |= 2;
      }
      // Touching a waiting balloon chains into it: a short, engineered fuse.
      if (balloons.has(t)) rank |= 1;
    }
    if (hits || endgame) candidates.push({ tile, arrival, rank: hits ? rank : -1, chain: false });
  }
  if (ctx.tuning.predictive) chainSpots(ctx, reach, maxTicks, direct, candidates);
  return candidates.sort((a, b) => b.rank - a.rank || a.arrival - b.arrival);
}

/**
 * Hard: chain spots. A balloon dropped where a pending splash will reach it bursts with that
 * splash, long before its own fuse runs out: an opponent it catches has only what is left of the
 * earlier fuse to get away (an engineered chain burst). Such a tile is never campable, so it is
 * only worth walking onto to drop a balloon that splashes an opponent's tile.
 */
function chainSpots(ctx: BotContext, reach: Reach, maxTicks: number, direct: ReadonlySet<number>, out: Candidate[]): void {
  for (let tile = 0; tile < reach.anyAt.length; tile++) {
    const arrival = reach.anyAt[tile];
    // Only the tile's first dry window, before the water comes (a later one may be campable).
    if (arrival > ctx.tick + maxTicks || arrival >= reach.campAt[tile]) continue;
    const wet = ctx.exact.firstWetFrom(tile, arrival + 1);
    if (wet <= arrival + CHAIN_SPOT_LINGER || wet >= arrival + 1 + CONFIG.FUSE_TICKS) continue;
    if (!canDropOn(ctx, tile) || kickerNear(ctx, tile)) continue;
    if (crossOf(ctx, tile).some((t) => direct.has(t))) out.push({ tile, arrival, rank: 3, chain: true });
  }
}

/** Which attack spots the caller can use at all: the others are dropped before their costly escape check. */
export interface AttackWants {
  /** A balloon on this tile could become a goal. */
  tile(tile: number): boolean;
  /** This threat is worth a balloon. */
  threat(threat: Threat): boolean;
}

/** A candidate verified: in the tide end game the survival race, otherwise real pressure plus the bot's escape. */
function evaluateAttack(ctx: BotContext, c: Candidate, wants: AttackWants): AttackOption | null {
  if (!wants.tile(c.tile)) return null;
  const placeTick = Math.max(c.arrival, ctx.tick) + 1;
  const hypo = dropHypothesis(ctx, c.tile, placeTick);
  const mover = c.tile === ctx.here ? ctx.mover : moverAtTile(ctx.s, c.tile, ctx.mover.speed);
  if (inTideEndgame(ctx, placeTick)) {
    const shot = endgameShot(ctx, hypo, c.tile, mover, placeTick);
    if (shot) {
      const threat = { score: TRAPPED_SCORE * shot.victims.length, trapped: true, trappedSlots: shot.victims, tight: false };
      return { tile: c.tile, arrival: c.arrival, threat, escape: shot.escape, chain: c.chain };
    }
  }
  const threat = threatOf(ctx, hypo, { tile: c.tile, placeTick });
  if (threat.score <= 0 || !wants.threat(threat)) return null;
  // A chain spot is only worth the walk into the water's way for a kill or a squeeze.
  if (c.chain && !threat.trapped && !threat.tight) return null;
  const escape = escapeUnder(ctx, hypo, c.tile, mover, placeTick, threat.trappedSlots);
  return escape ? { tile: c.tile, arrival: c.arrival, threat, escape, chain: c.chain } : null;
}

/**
 * The best verified attack spots among the `maxEval` most promising reachable ones within
 * `maxTicks` that the caller `wants`: the bot can still escape and the threat is real. Best first.
 */
export function findAttackOptions(ctx: BotContext, reach: Reach, maxTicks: number, maxEval: number, wants: AttackWants): AttackOption[] {
  if (ctx.opponents.length === 0) return [];
  const options: AttackOption[] = [];
  for (const c of attackCandidates(ctx, reach, maxTicks).slice(0, maxEval)) {
    const option = evaluateAttack(ctx, c, wants);
    if (option) options.push(option);
  }
  return options.sort((a, b) => b.threat.score - a.threat.score || a.arrival - b.arrival);
}

/** Tiles (Manhattan) around a fresh balloon within which an opponent wearing Boots could kick it back. */
const KICKER_REACH = 1;

/**
 * An opponent with Boots near the drop tile could kick the balloon somewhere its fuse was never
 * planned for (into lingering water it bursts at once): careful bots do not drop there.
 */
export function kickerNear(ctx: BotContext, tile: number): boolean {
  if (!ctx.s.rules.kick) return false;
  return ctx.opponents.some((o) => o.canKick && tileDistance(ctx.s.w, tileOfPlayer(ctx, o), tile) <= KICKER_REACH);
}

/** How close (tiles) an opponent must be for this bot to consider attacking it. */
export function attackRadius(ctx: BotContext): number {
  return Math.min(ctx.tuning.attackRadius, ctx.me.range + 4);
}

/** Nearest opponent distance in tiles (Infinity with no opponent). */
export function nearestOpponentDistance(ctx: BotContext, tile = ctx.here): number {
  let best = Infinity;
  for (const o of ctx.opponents) best = Math.min(best, tileDistance(ctx.s.w, tileOfPlayer(ctx, o), tile));
  return best;
}
