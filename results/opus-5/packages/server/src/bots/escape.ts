/**
 * The promise a bot makes itself before it lights a fuse.
 *
 * Everything here is about having somewhere to be when the balloon goes off:
 * how long a tile has to stay dry before it is worth standing on, how many ways
 * off it there are, and whether the splash the bot is about to make still
 * leaves it a route out.
 */

import { CARDINALS, CONFIG, DIR_VECTORS, idx, makeSolidFn, playerTile } from '@splash/shared';
import type { GameState, PlayerState, SolidFn } from '@splash/shared';
import { computeDangerMapWith } from './dangerMap.js';
import { exploreReachable, pathTo, safeToLinger, tileX, tileY } from './pathfind.js';

const MARGIN = CONFIG.BOT_SAFETY_MARGIN_TICKS;
/** Corridors are long: a bot wants room for this many tiles of running. */
const ESCAPE_TILES = 4;
/** An enemy this close can reach the one exit before the fuse runs out. */
const SEAL_RANGE = 6;
/**
 * A bolt-hole with one way in is a bottle: cork it with a balloon and whoever
 * is inside stays there. Escapes always run to somewhere with a choice.
 */
const ESCAPE_EXITS = 2;

/** Ticks the bot needs to cross one tile at its current speed. */
export function ticksPerTile(player: PlayerState): number {
  return CONFIG.TICK_RATE / player.speed;
}

/**
 * How long a tile has to stay dry before a bot is willing to stand on it.
 * Six ticks of margin is not enough on its own: by the time a fuse is that
 * short the bot is already in the splash, so the horizon includes the walk out.
 */
export function dwellTicks(player: PlayerState): number {
  return ticksPerTile(player) * ESCAPE_TILES + MARGIN;
}

/**
 * Ways off a tile, counting a balloon as a wall. Bombing a dead end is how a
 * bot walls itself in: the one exit is exactly where an enemy drops the next
 * balloon, and by then the fuse is lit and there is nowhere to be.
 */
export function exitCount(state: GameState, solid: SolidFn, tile: number, blocked = -1): number {
  const tx = tileX(state.width, tile);
  const ty = tileY(state.width, tile);
  let exits = 0;
  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    const next = idx(state.width, tx + dx, ty + dy);
    if (next === blocked) continue;
    if (!solid(tx + dx, ty + dy)) exits++;
  }
  return exits;
}

/** Tiles a bot is willing to be caught standing on. */
export type TileFilter = (tile: number) => boolean;

export const ANY_TILE: TileFilter = () => true;

/** Somewhere with enough ways out that one balloon cannot close them all. */
export function roomyTiles(
  state: GameState,
  player: PlayerState,
  need: number,
  blocked = -1,
): TileFilter {
  const solid = makeSolidFn(state, player.id);
  return (tile) => exitCount(state, solid, tile, blocked) >= need;
}

/** Manhattan tiles to the nearest critter still in the round. */
function enemyDistance(state: GameState, player: PlayerState): number {
  const { tx, ty } = playerTile(player);
  let best = Infinity;
  for (const other of state.players) {
    if (!other.alive || other.id === player.id) continue;
    const seen = playerTile(other);
    best = Math.min(best, Math.abs(seen.tx - tx) + Math.abs(seen.ty - ty));
  }
  return best;
}

/**
 * Alone in a corner, one way out is plenty. With somebody close enough to drop
 * a balloon in that gap, one way out is a coffin, so demand two.
 */
export function requiredExits(state: GameState, player: PlayerState): number {
  return enemyDistance(state, player) <= SEAL_RANGE ? 2 : 1;
}

/**
 * Simulate the balloon before committing to it: the splash it would make, every
 * chain it would set off and everything already dangerous. Returns the route
 * out, or null when there is none - in which case the bot does not place it.
 */
export function verifyBomb(
  state: GameState,
  player: PlayerState,
  tile: number,
  placedAt: number,
): number[] | null {
  const tx = tileX(state.width, tile);
  const ty = tileY(state.width, tile);
  const burstAt = placedAt + CONFIG.FUSE_TICKS;
  const hypothetical = computeDangerMapWith(state, {
    x: tx,
    y: ty,
    range: player.splashRange,
    tick: burstAt,
  });

  const escapeReach = exploreReachable({
    width: state.width,
    height: state.height,
    // The bot is standing on the balloon it just dropped, so dead centre.
    startX: tx + 0.5,
    startY: ty + 0.5,
    startTick: placedAt,
    ticksPerTile: ticksPerTile(player),
    solid: makeSolidFn(state, player.id),
    danger: hypothetical,
  });

  const settled = burstAt + CONFIG.SPLASH_TICKS + MARGIN;
  // The balloon itself walls off the tile it is on, so a bolt-hole beside it is
  // one balloon away from being no bolt-hole at all. Prefer a roomy one.
  const roomy = roomyTiles(state, player, ESCAPE_EXITS, tile);
  // A rival close enough to drop a balloon in the corridor can cork a single
  // escape route while the fuse burns, so near one the bot wants two routes
  // leaving in different directions before it commits.
  const routesNeeded = requiredExits(state, player);
  const firstSteps = new Set<number>();
  let chosen: number[] | null = null;
  let preferred: number[] | null = null;

  for (const candidate of escapeReach.visited) {
    if (candidate === escapeReach.startIndex) continue;
    const arrive = escapeReach.arrive[candidate];
    // Being there before the fuse runs out is the whole point of an escape.
    if (arrive > burstAt) continue;
    const cx = tileX(state.width, candidate);
    const cy = tileY(state.width, candidate);
    if (!safeToLinger(hypothetical, cx, cy, arrive, settled - arrive)) continue;

    const path = pathTo(escapeReach, candidate);
    if (path.length === 0) continue;
    firstSteps.add(path[0]);
    if (chosen === null) chosen = path;
    if (preferred === null && roomy(candidate)) preferred = path;
    if (preferred !== null && firstSteps.size >= routesNeeded) break;
  }

  if (firstSteps.size < routesNeeded) return null;
  return preferred ?? chosen;
}
