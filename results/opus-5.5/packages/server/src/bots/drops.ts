// When to drop a balloon on the tile the bot stands on: castles to wash (farming) or opponents to
// trap/pressure (attack, gated by the difficulty's aggression). A drop is only ever made with a
// verified escape against the exact danger map, own chains included.
import { PowerUp, Tile, activeBalloonCount } from '@splash/shared';
import { attackRadius, crossOf, kickerNear, nearestOpponentDistance, threatOf, type Threat } from './attack';
import { SEARCH_HORIZON, canDropOn, type BotContext } from './context';
import { playerTileIndex } from './motion';
import type { DangerMap } from './dangerMap';
import { endgameShot, inTideEndgame } from './endgame';
import { planCombo } from './combo';
import { dropHypothesis, escapeUnder, type Escape } from './escape';

/** Castles a balloon on `tile` would wash that no pending splash already covers, minus items it would destroy. */
export function farmValue(ctx: BotContext, tile: number): number {
  const { s } = ctx;
  let castles = 0;
  let items = 0;
  for (const t of crossOf(ctx, tile)) {
    if (s.tiles[t] === Tile.Castle) {
      if (ctx.exact.firstWetFrom(t, ctx.tick + 1) > ctx.tick + SEARCH_HORIZON) castles++;
    } else if (t !== tile && s.items[t] !== PowerUp.None) {
      items++;
    }
  }
  return castles - 0.7 * items;
}

/** Hard bots spend the opening on power-ups and castles, then turn aggressive. */
export function isEarlyGame(ctx: BotContext): boolean {
  return ctx.tick < 600 && ctx.me.maxBalloons + ctx.me.range < 5;
}

/** Ticks before the tide from which Hard bots go all out for the kill. */
const LATE_GAME_TICKS = 30 * 30;

/**
 * The end of the round is near (or nothing is left to farm): once the tide shrinks the arena the
 * round ends in a draw unless someone is soaked first, so Hard bots hunt instead of farming.
 */
export function isLateGame(ctx: BotContext): boolean {
  const { s } = ctx;
  if (s.rules.tide && ctx.tick >= s.rules.tideStartTick - LATE_GAME_TICKS) return true;
  return !s.tiles.includes(Tile.Castle);
}

/** Is this threat worth a balloon? (The same bar applies to attack goals and to dropping on arrival.) */
export function attackWanted(ctx: BotContext, threat: Threat): boolean {
  if (threat.trapped || threat.tight) return true;
  if (ctx.difficulty === 'hard') return threat.score >= (isEarlyGame(ctx) ? 2 : 1);
  return threat.score >= 1;
}

export interface DropIntent {
  /** The bot walked here to attack: skip the aggression roll. */
  committed: boolean;
  /** Mid-escape: only a strong attack justifies another balloon (never farming). */
  attackOnly: boolean;
  /** How often this very attack (see attackKey) was made already: past MAX_ATTACK_REPEATS only a trap is. */
  repeats: number;
}

/** A balloon to drop right here and the verified way out; `attack` when it was dropped to hurt opponents. */
export interface DropDecision {
  escape: Escape;
  attack: boolean;
}

/**
 * An attack that has failed this often against opponents standing just where they stand now is
 * not repeated (only a sure trap is): against a player who dodges it the same way every time, or
 * one that holds its ground, the bot would otherwise loop through the same few futile drops.
 */
export const MAX_ATTACK_REPEATS = 2;

/** The attack of a balloon on `tile` against the opponents where they stand now. */
export function attackKey(ctx: BotContext, tile: number): string {
  const at = ctx.opponents.map((o) => playerTileIndex(ctx.s, o)).sort((a, b) => a - b);
  return `${tile}:${at.join(',')}`;
}

/** Should the bot drop right now? Returns the decision with its verified escape, or null to keep going. */
export function decideDropHere(ctx: BotContext, intent: DropIntent): DropDecision | null {
  const { s, me } = ctx;
  if (ctx.passive || activeBalloonCount(s, ctx.slot) >= me.maxBalloons || !canDropOn(ctx, ctx.here)) return null;
  if (ctx.difficulty !== 'easy' && kickerNear(ctx, ctx.here)) return null;
  const placeTick = ctx.tick + 1;
  const committed = intent.committed;
  // Sudden death: a balloon that makes an opponent run dry first decides the round.
  if (ctx.difficulty !== 'easy' && inTideEndgame(ctx, placeTick) && (committed || ctx.rng() < ctx.tuning.aggression)) {
    const shot = endgameShot(ctx, dropHypothesis(ctx, ctx.here, placeTick), ctx.here, ctx.mover, placeTick);
    if (shot) return { escape: shot.escape, attack: true };
  }
  const farm = !intent.attackOnly && farmValue(ctx, ctx.here) >= 1;
  let attack = false;
  let trapped: number[] = [];
  let hypo: DangerMap | undefined;
  const near = nearestOpponentDistance(ctx) <= attackRadius(ctx);
  if (near && (committed || ctx.rng() < ctx.tuning.aggression)) {
    hypo = dropHypothesis(ctx, ctx.here, placeTick);
    const threat = threatOf(ctx, hypo, { tile: ctx.here, placeTick });
    trapped = threat.trappedSlots;
    const fresh = threat.trapped || intent.repeats < MAX_ATTACK_REPEATS;
    attack = fresh && (intent.attackOnly ? threat.trapped || threat.tight || threat.score >= 2 : attackWanted(ctx, threat));
    if (fresh && ctx.difficulty === 'hard' && !threat.trapped && !threat.tight && threat.score > 0) {
      const combo = planCombo(ctx, hypo, { tile: ctx.here, placeTick });
      if (combo && escapeUnder(ctx, hypo, ctx.here, ctx.mover, placeTick)) return { escape: combo.escape, attack: true };
    }
  }
  if (!farm && !attack) return null;
  hypo ??= dropHypothesis(ctx, ctx.here, placeTick);
  const escape = escapeUnder(ctx, hypo, ctx.here, ctx.mover, placeTick, trapped);
  return escape ? { escape, attack } : null;
}
