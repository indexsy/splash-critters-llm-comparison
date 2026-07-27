/**
 * Bot brains.
 *
 * A bot returns an input every tick but only thinks every `intervalMs`: in
 * between it walks the plan it already committed to, which is what makes it
 * look like a player rather than a twitching cursor. Thinking is a strict
 * priority list - get out of the splash first, never light a fuse without a
 * verified way out, then farm, collect and hunt.
 */

import {
  CONFIG,
  Dir,
  borderPosFromPoint,
  idx,
  makeRng,
  makeSolidFn,
  perimeterLength,
  playerTile,
} from '@splash/shared';
import type {
  BotDifficulty,
  BotProfile,
  DirValue,
  GameState,
  PlayerInput,
  PlayerState,
  Rng,
} from '@splash/shared';
import { blindDangerMap, computeDangerMap } from './dangerMap.js';
import type { DangerMap } from './dangerMap.js';
import {
  dangerousDuring,
  exitTicks,
  exploreReachable,
  manhattan,
  pathTo,
  safeToLinger,
  stepDir,
  tileX,
  tileY,
} from './pathfind.js';
import type { Reachability } from './pathfind.js';
import {
  ANY_TILE,
  dwellTicks,
  exitCount,
  requiredExits,
  roomyTiles,
  ticksPerTile,
  verifyBomb,
} from './escape.js';
import type { TileFilter } from './escape.js';
import { attackCandidates, castleCandidates, kickPush, powerupCandidates } from './targets.js';

export interface BotController {
  readonly slot: number;
  readonly difficulty: BotDifficulty;
  /** Called every tick. Returns the input this bot wants applied this tick. */
  update(state: GameState, nowMs: number): PlayerInput;
  /** Clear per-round memory at round_start. */
  reset(): void;
}

interface Plan {
  /** Tiles still to walk, nearest first. */
  path: number[];
  /** Drop a balloon once the path is walked out. */
  bomb: boolean;
  /** Held direction used to boot a balloon down a lane. */
  push: DirValue;
}

/** Escape verification is the expensive part, so only the best few get one. */
const MAX_BOMB_CHECKS = 3;
/**
 * Every live balloon bursts within one fuse, so a tile that survives a whole
 * fuse is a tile nothing currently threatens. That is where bots come to rest.
 */
const REST_TICKS = CONFIG.FUSE_TICKS;

function emptyPlan(): Plan {
  return { path: [], bomb: false, push: Dir.NONE };
}

function idleInput(state: GameState, seq: number): PlayerInput {
  return { seq, tick: state.tick, dir: Dir.NONE, balloonPressed: false };
}

/**
 * All bots polled on the same tick see the same world, so the map is built once
 * and shared. Keyed on the state object, so a cloned state gets its own.
 */
const dangerCache = new WeakMap<GameState, { tick: number; map: DangerMap }>();

function sharedDanger(state: GameState): DangerMap {
  const cached = dangerCache.get(state);
  if (cached && cached.tick === state.tick) return cached.map;
  const map = computeDangerMap(state);
  dangerCache.set(state, { tick: state.tick, map });
  return map;
}

function buildReach(state: GameState, player: PlayerState, danger: DangerMap): Reachability {
  return exploreReachable({
    width: state.width,
    height: state.height,
    startX: player.x,
    startY: player.y,
    startTick: state.tick,
    ticksPerTile: ticksPerTile(player),
    solid: makeSolidFn(state, player.id),
    danger,
  });
}

// --------------------------------------------------------------------- fleeing

function walkPlan(reach: Reachability, tile: number): Plan {
  return { path: pathTo(reach, tile), bomb: false, push: Dir.NONE };
}

/** Nearest reachable tile the bot could stand on for `horizon` ticks unharmed. */
function nearestSafe(
  danger: DangerMap,
  reach: Reachability,
  horizon: number,
  ok: TileFilter,
): number {
  for (const tile of reach.visited) {
    const tx = tileX(reach.width, tile);
    const ty = tileY(reach.width, tile);
    if (!safeToLinger(danger, tx, ty, reach.arrive[tile], horizon)) continue;
    if (!ok(tile)) continue;
    return tile;
  }
  return -1;
}

/**
 * Nowhere is truly safe once the tide is closing in, so head for whichever
 * reachable tile stays dry the longest. A bot with no plan is a drowned bot.
 */
function survivalPlan(danger: DangerMap, reach: Reachability): Plan {
  let best = -1;
  let bestBurst = -Infinity;
  for (const tile of reach.visited) {
    if (tile === reach.startIndex) continue;
    if (danger.burstTick[tile] > bestBurst) {
      bestBurst = danger.burstTick[tile];
      best = tile;
    }
  }
  if (best < 0) return emptyPlan();
  return walkPlan(reach, best);
}

/**
 * Somewhere out of this. First choice is a tile no live fuse can touch; if the
 * arena is that crowded, settle for one that holds long enough to think again.
 */
function fleePlan(
  danger: DangerMap,
  reach: Reachability,
  dwell: number,
  roomy: TileFilter,
): Plan {
  for (const [horizon, ok] of [
    [REST_TICKS, roomy],
    [REST_TICKS, ANY_TILE],
    [dwell, ANY_TILE],
  ] as Array<[number, TileFilter]>) {
    const tile = nearestSafe(danger, reach, horizon, ok);
    if (tile >= 0) return walkPlan(reach, tile);
  }
  return survivalPlan(danger, reach);
}

// -------------------------------------------------------------------- thinking

function wanderPlan(
  danger: DangerMap,
  reach: Reachability,
  rng: Rng,
  dwell: number,
  roomy: TileFilter,
): Plan {
  const options: number[] = [];
  for (const tile of reach.visited) {
    if (tile === reach.startIndex) continue;
    const tx = tileX(reach.width, tile);
    const ty = tileY(reach.width, tile);
    if (!safeToLinger(danger, tx, ty, reach.arrive[tile], REST_TICKS)) continue;
    if (roomy(tile)) options.push(tile);
  }
  if (options.length === 0) return fleePlan(danger, reach, dwell, roomy);
  return walkPlan(reach, options[rng.int(options.length)]);
}

/**
 * Walk the plan forward in time: is the bot ever standing on a tile while it is
 * being splashed, and does it come to rest somewhere it can stay? Judging the
 * whole trajectory rather than the tile underfoot is what stops a bot from
 * bouncing on the edge of a blast until the fuse runs out.
 */
function planValid(state: GameState, player: PlayerState, danger: DangerMap, plan: Plan): boolean {
  const { tx, ty } = playerTile(player);
  const tpt = ticksPerTile(player);
  const solid = makeSolidFn(state, player.id);
  let prev = idx(state.width, tx, ty);
  let at = state.tick;
  let first = true;

  for (const tile of plan.path) {
    if (tile === prev) continue;
    if (manhattan(state.width, prev, tile) !== 1) return false;
    const px = tileX(state.width, prev);
    const py = tileY(state.width, prev);
    const cost = first
      ? exitTicks(player.x, player.y, stepDir(state.width, prev, tile), tpt)
      : tpt;
    if (dangerousDuring(danger, px, py, at, at + cost)) return false;
    const nx = tileX(state.width, tile);
    const ny = tileY(state.width, tile);
    if (solid(nx, ny)) return false;
    if (dangerousDuring(danger, nx, ny, at, at + cost)) return false;
    prev = tile;
    at += cost;
    first = false;
  }

  const ex = tileX(state.width, prev);
  const ey = tileY(state.width, prev);
  return safeToLinger(danger, ex, ey, at, dwellTicks(player));
}

function decide(
  state: GameState,
  player: PlayerState,
  danger: DangerMap,
  profile: BotProfile,
  rng: Rng,
  current: Plan,
  blind: boolean,
): Plan {
  // An easy bot's mistake is concrete: for this one decision it believes the
  // arena is harmless. It still verifies its own balloons, which is a rule.
  const view = blind ? blindDangerMap(danger) : danger;
  const reach = buildReach(state, player, view);
  const { tx, ty } = playerTile(player);
  const dwell = dwellTicks(player);
  const roomy = roomyTiles(state, player, requiredExits(state, player));

  if (!safeToLinger(view, tx, ty, state.tick, dwell)) {
    // Already walking out of it? Then keep walking. Turning back on the edge of
    // a blast is how a bot ends up standing in the middle of one.
    if (planValid(state, player, view, current)) return current;
    return fleePlan(view, reach, dwell, roomy);
  }

  if (profile.engineersChains && player.hasKick) {
    const push = kickPush(state, player, danger, dwell);
    if (push !== Dir.NONE) return { path: [], bomb: false, push };
  }

  const tpt = ticksPerTile(player);
  const candidates = powerupCandidates(state, reach, profile, tpt);
  if (player.activeBalloons < player.balloonCount) {
    candidates.push(...castleCandidates(state, reach, tpt));
    candidates.push(...attackCandidates(state, player, reach, profile, tpt));
  }
  candidates.sort((a, b) => b.score - a.score || a.tile - b.tile);

  let checks = 0;
  for (const candidate of candidates) {
    const arrive = reach.arrive[candidate.tile];
    const cx = tileX(state.width, candidate.tile);
    const cy = tileY(state.width, candidate.tile);
    if (!candidate.bomb) {
      // Nothing is worth walking into a blast for, least of all a power-up.
      if (!safeToLinger(view, cx, cy, arrive, REST_TICKS)) continue;
      return walkPlan(reach, candidate.tile);
    }
    if (!roomy(candidate.tile)) continue;
    if (!safeToLinger(view, cx, cy, arrive, dwell)) continue;
    if (checks >= MAX_BOMB_CHECKS) break;
    checks++;
    // The route out is proven now and proven again on the tick it is dropped.
    if (verifyBomb(state, player, candidate.tile, arrive) === null) continue;
    return { path: pathTo(reach, candidate.tile), bomb: true, push: Dir.NONE };
  }

  return wanderPlan(view, reach, rng, dwell, roomy);
}

function follow(state: GameState, player: PlayerState, plan: Plan, seq: number): PlayerInput {
  const { tx, ty } = playerTile(player);
  const here = idx(state.width, tx, ty);
  while (plan.path.length > 0 && plan.path[0] === here) plan.path.shift();

  if (plan.path.length === 0 && plan.bomb) {
    plan.bomb = false;
    // The world has moved since this was planned, so the way out is re-checked
    // against the world as it is on the tick the balloon actually goes down.
    const exits = requiredExits(state, player);
    if (exitCount(state, makeSolidFn(state, player.id), here) < exits) return idleInput(state, seq);
    const escape = verifyBomb(state, player, here, state.tick);
    if (escape === null) return idleInput(state, seq);
    plan.path = escape;
    // Drop it and go, on the same tick: the sim places the balloon first.
    return {
      seq,
      tick: state.tick,
      dir: stepDir(state.width, here, escape[0]),
      balloonPressed: true,
    };
  }
  if (plan.path.length === 0) {
    return { seq, tick: state.tick, dir: plan.push, balloonPressed: false };
  }
  return {
    seq,
    tick: state.tick,
    dir: stepDir(state.width, here, plan.path[0]),
    balloonPressed: false,
  };
}

/** Soaked bots paddle after the survivors and lob whenever the duck reloads. */
function ghostInput(state: GameState, player: PlayerState, seq: number): PlayerInput {
  if (!player.ghost) return idleInput(state, seq);
  const total = perimeterLength(state.width, state.height);
  let dir: DirValue = Dir.NONE;
  let bestGap = Infinity;

  for (const other of state.players) {
    if (!other.alive) continue;
    const target = borderPosFromPoint(state.width, state.height, other.x, other.y);
    const ahead = (((target - player.ghostPos) % total) + total) % total;
    const gap = Math.min(ahead, total - ahead);
    if (gap >= bestGap) continue;
    bestGap = gap;
    dir = ahead === 0 ? Dir.NONE : ahead < total / 2 ? Dir.RIGHT : Dir.LEFT;
  }

  return { seq, tick: state.tick, dir, balloonPressed: player.ghostCooldown === 0 };
}

export function createBot(slot: number, difficulty: BotDifficulty, seed: number): BotController {
  const profile = CONFIG.BOT_PROFILES[difficulty];
  // Mixing the slot in keeps two bots on one seeded round from acting in lockstep.
  const rng = makeRng((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0);
  let plan = emptyPlan();
  let nextDecisionMs = -Infinity;
  // A misjudgement has to last long enough to hurt, so a bot that talked itself
  // into a bad plan lives with it until its next decision instead of noticing
  // one tick later. This is what gives BOT_PROFILES.errorRate teeth.
  let committedUntilMs = -Infinity;
  let seq = 0;

  return {
    slot,
    difficulty,
    update(state: GameState, nowMs: number): PlayerInput {
      seq++;
      const player = state.players.find((p) => p.id === slot);
      if (!player) return idleInput(state, seq);
      if (!player.alive) return ghostInput(state, player, seq);
      if (state.phase !== 'playing') {
        plan = emptyPlan();
        return idleInput(state, seq);
      }

      const danger = sharedDanger(state);
      const done = plan.path.length === 0 && !plan.bomb && plan.push === Dir.NONE;
      const rethink =
        done ||
        nowMs >= nextDecisionMs ||
        (nowMs >= committedUntilMs && !planValid(state, player, danger, plan));
      if (rethink) {
        const blind = profile.errorRate > 0 && rng.chance(profile.errorRate);
        plan = decide(state, player, danger, profile, rng, plan, blind);
        nextDecisionMs = nowMs + profile.intervalMs;
        committedUntilMs = blind ? nextDecisionMs : -Infinity;
      }
      return follow(state, player, plan, seq);
    },
    reset(): void {
      plan = emptyPlan();
      nextDecisionMs = -Infinity;
      committedUntilMs = -Infinity;
    },
  };
}
