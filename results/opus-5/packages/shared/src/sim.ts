/**
 * The deterministic simulation.
 *
 * `simulateTick` is the single entry point and is byte-identical on the server
 * (authority) and in the browser (prediction). It reads like the round it is
 * describing: advance the phase, let the critters act, slide and burst the
 * balloons, raise the tide, hand out power-ups, soak whoever is standing in the
 * wrong place, then see whether anybody is left.
 */

import { CONFIG } from './config.js';
import {
  Dir,
  EMPTY_INPUT,
  type GameState,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
} from './types.js';
import { refreshPassThrough, tryKick, tryPlaceBalloon, updateSlides } from './sim/balloons.js';
import { updateGhosts, updateLobs } from './sim/ducks.js';
import { distPerTick, stepEntity } from './sim/movement.js';
import { collectPowerups } from './sim/powerups.js';
import { expireSplashes, processBursts, resolveSoaks } from './sim/splash.js';
import { advanceTide } from './sim/tide.js';
import { alivePlayers, makeSolidFn } from './sim/state.js';

export interface AdvanceOptions {
  /** Client prediction places balloons optimistically; the server is truth. */
  placeBalloons?: boolean;
}

/**
 * One critter's turn: drop, walk, kick. Exported on its own because the client
 * replays exactly this for the local player during reconciliation.
 */
export function advancePlayer(
  state: GameState,
  player: PlayerState,
  input: PlayerInput,
  opts: AdvanceOptions = {},
): void {
  if (!player.alive) return;

  if (input.balloonPressed && opts.placeBalloons !== false) tryPlaceBalloon(state, player);

  const solid = makeSolidFn(state, player.id);
  const result = stepEntity(solid, player, input.dir, distPerTick(player.speed));

  player.moving = result.moved;
  if (input.dir !== Dir.NONE) player.facing = input.dir;
  if (result.blocked) tryKick(state, player, input.dir, result.blockedX, result.blockedY);
}

function tickEmotes(state: GameState): void {
  for (const player of state.players) {
    if (player.emoteTicks > 0) player.emoteTicks--;
    if (player.emoteCooldown > 0) player.emoteCooldown--;
  }
}

/** Rate-limited in the sim as well as on the socket. */
export function tryEmote(state: GameState, playerId: number, emoteId: number): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  if (player.emoteCooldown > 0) return false;
  if (!Number.isInteger(emoteId) || emoteId < 0 || emoteId >= CONFIG.EMOTE_COUNT) return false;
  player.emoteId = emoteId;
  player.emoteTicks = CONFIG.EMOTE_BUBBLE_TICKS;
  player.emoteCooldown = CONFIG.EMOTE_COOLDOWN_TICKS;
  state.events.push({ kind: 'emote', playerId, emoteId });
  return true;
}

function advancePhase(state: GameState): void {
  if (state.phase === 'countdown' && state.tick >= state.phaseEndTick) {
    state.phase = 'playing';
  }
}

function endRound(state: GameState, winners: number[]): void {
  state.phase = 'ended';
  state.winners = winners;
  state.phaseEndTick = state.tick + CONFIG.ROUND_END_TICKS;
  state.events.push({ kind: 'round_over', winners });
}

function checkRoundEnd(state: GameState): void {
  const alive = alivePlayers(state);
  const soloRound = state.players.length < 2;

  if (!soloRound && alive.length <= 1) {
    endRound(state, alive.map((p) => p.id));
    return;
  }
  if (soloRound && alive.length === 0) {
    endRound(state, []);
    return;
  }
  if (state.tick >= CONFIG.ROUND_MAX_TICKS) {
    endRound(state, []);
  }
}

/**
 * Advance the world by exactly one tick and return the events it produced.
 * The caller owns the returned array; it is replaced on the next call.
 */
export function simulateTick(state: GameState, inputs: Map<number, PlayerInput>): SimEvent[] {
  state.events = [];
  state.tick++;

  expireSplashes(state);
  tickEmotes(state);
  advancePhase(state);

  if (state.phase !== 'playing') return state.events;

  for (const player of state.players) {
    if (!player.alive) continue;
    advancePlayer(state, player, inputs.get(player.id) ?? EMPTY_INPUT);
    player.survivedTicks++;
  }

  updateSlides(state);
  refreshPassThrough(state);
  updateGhosts(state, inputs);
  updateLobs(state);
  processBursts(state);
  advanceTide(state);
  collectPowerups(state);
  resolveSoaks(state);
  checkRoundEnd(state);

  return state.events;
}

export { createRoundState, cloneState } from './sim/state.js';
export type { RoundOptions, SolidFn } from './sim/state.js';
export {
  alivePlayers,
  balloonAtTile,
  createPlayer,
  inBounds,
  makeSolidFn,
  makeStrictSolidFn,
  overlapsTile,
  playerTile,
  setTile,
  tileAt,
} from './sim/state.js';
export { boxBlocked, distPerTick, stepEntity } from './sim/movement.js';
export type { MoveResult, Movable } from './sim/movement.js';
export { spawnBalloon, tryPlaceBalloon, tryKick, updateSlides } from './sim/balloons.js';
export { applyPowerup, collectPowerups, decodeContents } from './sim/powerups.js';
export { processBursts, resolveSoaks, soakPlayer, splashCoversTile, expireSplashes } from './sim/splash.js';
export { advanceTide, ticksUntilTide } from './sim/tide.js';
export {
  borderPosFromPoint,
  inwardDir,
  perimeterLength,
  perimeterPoint,
  perimeterTile,
  updateGhosts,
  updateLobs,
} from './sim/ducks.js';
