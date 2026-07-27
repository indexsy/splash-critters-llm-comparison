/**
 * What a bot might want to do next, scored so the brain can just take the best.
 *
 * Every candidate is a tile to walk to; `bomb` says whether a balloon goes down
 * on arrival. Scores are value minus tiles of walking, so a distant power-up
 * loses to a sandcastle underfoot.
 */

import {
  CARDINALS,
  CONFIG,
  DIR_VECTORS,
  Dir,
  Tile,
  balloonAtTile,
  idx,
  playerTile,
  tileAt,
} from '@splash/shared';
import type { BotProfile, DirValue, GameState, PlayerState } from '@splash/shared';
import type { DangerMap } from './dangerMap.js';
import { manhattan, safeToLinger, tileX, tileY } from './pathfind.js';
import type { Reachability } from './pathfind.js';

export interface Candidate {
  tile: number;
  bomb: boolean;
  score: number;
}

const CASTLE_VALUE = 7;
const CASTLE_STACK_BONUS = 1.5;
const POWERUP_VALUE = 10;
const POWERUP_EARLY_VALUE = 17;
/**
 * Attacking is scored entirely through the profile's aggression rather than
 * gated by a coin flip, so an easy bot lands well under CASTLE_VALUE and rarely
 * bothers, a medium bot edges past farming, and a hard bot always prefers blood.
 */
const ATTACK_VALUE = 16;
const CUTOFF_BONUS = 1.5;
const CHAIN_BONUS = 3;
/** How far ahead a hunting bot leads a walking target. */
const LEAD_TILES = 2;

/** Tiles of walking between here and there, used to discount distant goals. */
function travel(reach: Reachability, tile: number, fromTick: number, tpt: number): number {
  return (reach.arrive[tile] - fromTick) / tpt;
}

export function powerupCandidates(
  state: GameState,
  reach: Reachability,
  profile: BotProfile,
  tpt: number,
): Candidate[] {
  // Stat leads win the endgame, so a hunter grabs them while the arena is calm.
  const early = state.tick < CONFIG.TIDE_START_TICKS / 2;
  const value = profile.hunts && early ? POWERUP_EARLY_VALUE : POWERUP_VALUE;
  const out: Candidate[] = [];
  for (const powerup of state.powerups) {
    const tile = idx(state.width, powerup.x, powerup.y);
    if (reach.arrive[tile] === Infinity) continue;
    out.push({ tile, bomb: false, score: value - travel(reach, tile, state.tick, tpt) });
  }
  return out;
}

/** Every tile you could stand on to wash a sandcastle away. */
export function castleCandidates(
  state: GameState,
  reach: Reachability,
  tpt: number,
): Candidate[] {
  const spots = new Map<number, number>();
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] !== Tile.CASTLE) continue;
    const cx = tileX(state.width, i);
    const cy = tileY(state.width, i);
    for (const dir of CARDINALS) {
      const [dx, dy] = DIR_VECTORS[dir];
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
      const tile = idx(state.width, tx, ty);
      if (reach.arrive[tile] === Infinity) continue;
      spots.set(tile, (spots.get(tile) ?? 0) + 1);
    }
  }

  const out: Candidate[] = [];
  for (const [tile, count] of spots) {
    const score =
      CASTLE_VALUE + (count - 1) * CASTLE_STACK_BONUS - travel(reach, tile, state.tick, tpt);
    out.push({ tile, bomb: true, score });
  }
  return out;
}

/** Where a runner will be by the time the balloon goes off. */
function aimTile(state: GameState, enemy: PlayerState, lead: boolean): number {
  const { tx, ty } = playerTile(enemy);
  if (!lead || !enemy.moving) return idx(state.width, tx, ty);
  const [dx, dy] = DIR_VECTORS[enemy.facing];
  let ax = tx;
  let ay = ty;
  for (let step = 1; step <= LEAD_TILES; step++) {
    const nx = tx + dx * step;
    const ny = ty + dy * step;
    if (tileAt(state, nx, ny) !== Tile.EMPTY) break;
    ax = nx;
    ay = ny;
  }
  return idx(state.width, ax, ay);
}

/** Tiles whose splash would reach `aim`. */
function firingTiles(state: GameState, aim: number, range: number): number[] {
  const ax = tileX(state.width, aim);
  const ay = tileY(state.width, aim);
  const out: number[] = [aim];
  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    for (let step = 1; step <= range; step++) {
      const tx = ax + dx * step;
      const ty = ay + dy * step;
      // A splash cannot come through anything, so neither can our line of fire.
      if (tileAt(state, tx, ty) !== Tile.EMPTY) break;
      out.push(idx(state.width, tx, ty));
    }
  }
  return out;
}

function openNeighbours(state: GameState, tile: number): number {
  const tx = tileX(state.width, tile);
  const ty = tileY(state.width, tile);
  let open = 0;
  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    if (tileAt(state, tx + dx, ty + dy) === Tile.EMPTY) open++;
  }
  return open;
}

function touchesBalloon(state: GameState, tile: number): boolean {
  const tx = tileX(state.width, tile);
  const ty = tileY(state.width, tile);
  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    if (balloonAtTile(state, tx + dx, ty + dy)) return true;
  }
  return false;
}

export function attackCandidates(
  state: GameState,
  player: PlayerState,
  reach: Reachability,
  profile: BotProfile,
  tpt: number,
): Candidate[] {
  const { tx, ty } = playerTile(player);
  const here = idx(state.width, tx, ty);
  const reachLimit = profile.hunts ? Infinity : profile.attackRange;
  const out: Candidate[] = [];

  for (const enemy of state.players) {
    if (!enemy.alive || enemy.id === player.id) continue;
    const aim = aimTile(state, enemy, profile.hunts);
    if (manhattan(state.width, here, aim) > reachLimit) continue;
    // A cornered critter is worth crowding; an open one will just walk away.
    const cutoff = profile.hunts ? (4 - openNeighbours(state, aim)) * CUTOFF_BONUS : 0;

    for (const tile of firingTiles(state, aim, player.splashRange)) {
      if (reach.arrive[tile] === Infinity) continue;
      let score =
        ATTACK_VALUE * profile.aggression + cutoff - travel(reach, tile, state.tick, tpt);
      if (profile.engineersChains && touchesBalloon(state, tile)) score += CHAIN_BONUS;
      out.push({ tile, bomb: true, score });
    }
  }
  return out;
}

/** Is there somebody standing in the lane this balloon would slide down? */
function enemyDownLane(state: GameState, player: PlayerState, from: number, dir: DirValue): boolean {
  const [dx, dy] = DIR_VECTORS[dir];
  let tx = tileX(state.width, from);
  let ty = tileY(state.width, from);
  for (;;) {
    tx += dx;
    ty += dy;
    if (tileAt(state, tx, ty) !== Tile.EMPTY) return false;
    for (const other of state.players) {
      if (!other.alive || other.id === player.id) continue;
      const tile = playerTile(other);
      if (tile.tx === tx && tile.ty === ty) return true;
    }
    if (balloonAtTile(state, tx, ty)) return false;
  }
}

/** Walk into your own balloon to send it at somebody. Rubber Boots only. */
export function kickPush(
  state: GameState,
  player: PlayerState,
  danger: DangerMap,
  dwell: number,
): DirValue {
  const { tx, ty } = playerTile(player);
  if (!safeToLinger(danger, tx, ty, state.tick, dwell)) return Dir.NONE;

  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    const balloon = balloonAtTile(state, tx + dx, ty + dy);
    if (!balloon || balloon.slideDir !== Dir.NONE) continue;
    // Still standing on it: walking into it would just walk onto it.
    if (balloon.passThrough.includes(player.id)) continue;
    if (!enemyDownLane(state, player, idx(state.width, tx + dx, ty + dy), dir)) continue;
    return dir;
  }
  return Dir.NONE;
}
