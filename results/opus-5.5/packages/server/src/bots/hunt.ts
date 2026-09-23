// Hunting an opponent the bot cannot reach yet: while sandcastles wall it off, the way to it
// leads through them. The castles to wash first are the ones on the edge of the bot's open
// area that lie on the cheapest way (a washed castle costs a few steps' time) to the nearest
// walled-off opponent. Farming spots that wash them are worth more to a hunting bot.
import { Tile } from '@splash/shared';
import type { BotContext } from './context';
import { neighbours, playerTileIndex } from './motion';

/** Steps a castle on the way counts for (drop, run, wait for the burst, come back). */
const CASTLE_STEPS = 4;
/** Frontier castles this many steps worse than the best one still count as on the way. */
const DIG_SLACK = 1;

/** Tiles reachable from `start` over floor (balloons and water ignored: they pass). */
function openArea(ctx: BotContext, start: number): Uint8Array {
  const { s } = ctx;
  const seen = new Uint8Array(s.w * s.h);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const n of neighbours(s.w, s.h, queue[head])) {
      if (seen[n] === 1 || s.tiles[n] !== Tile.Floor) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

/** Cheapest steps from any of `sources` to every tile, a castle costing CASTLE_STEPS (boulders impassable). */
function digDistances(ctx: BotContext, sources: readonly number[]): Float64Array {
  const { s } = ctx;
  const dist = new Float64Array(s.w * s.h).fill(Infinity);
  // Costs are small integers: a bucket queue keeps this linear.
  const buckets: number[][] = [];
  for (const t of sources) {
    dist[t] = 0;
    (buckets[0] ??= []).push(t);
  }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const t of bucket) {
      if (dist[t] !== d) continue;
      for (const n of neighbours(s.w, s.h, t)) {
        const tile = s.tiles[n];
        if (tile === Tile.Boulder) continue;
        const nd = d + (tile === Tile.Castle ? CASTLE_STEPS : 1);
        if (nd >= dist[n]) continue;
        dist[n] = nd;
        (buckets[nd] ??= []).push(n);
      }
    }
  }
  return dist;
}

/**
 * Castles to wash to get at the nearest walled-off opponent: those bordering the bot's open area
 * on (or nearly on) the cheapest way to it. Empty when some opponent can be walked to already or
 * none can be reached at all.
 */
export function digTargets(ctx: BotContext): Set<number> {
  const targets = new Set<number>();
  if (ctx.opponents.length === 0) return targets;
  const open = openArea(ctx, ctx.here);
  const opponentTiles = ctx.opponents.map((o) => playerTileIndex(ctx.s, o));
  if (opponentTiles.some((t) => open[t] === 1)) return targets;
  const dist = digDistances(ctx, opponentTiles);
  let best = Infinity;
  const frontier: number[] = [];
  for (let t = 0; t < open.length; t++) {
    if (ctx.s.tiles[t] !== Tile.Castle || dist[t] === Infinity) continue;
    if (!neighbours(ctx.s.w, ctx.s.h, t).some((n) => open[n] === 1)) continue;
    frontier.push(t);
    best = Math.min(best, dist[t]);
  }
  for (const t of frontier) if (dist[t] <= best + DIG_SLACK) targets.add(t);
  return targets;
}
