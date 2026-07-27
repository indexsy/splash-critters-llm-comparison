import {
  CONFIG,
  Tile,
  createRoundState,
  setTile,
  spawnBalloon,
  type GameMode,
  type GameState,
  type PlayerInput,
} from '../src/index.js';
import { Dir } from '../src/types.js';

/** A round with every sandcastle removed, already past the countdown. */
export function makeArena(mode: GameMode = 'duel', seed = 1234, slots = [0, 1]): GameState {
  const state = createRoundState({ mode, seed, slots, revengeDucks: false });
  for (let y = 1; y < state.height - 1; y++) {
    for (let x = 1; x < state.width - 1; x++) {
      if (state.cells[y * state.width + x] === Tile.CASTLE) setTile(state, x, y, Tile.EMPTY);
    }
  }
  state.castleContents.fill(0);
  state.phase = 'playing';
  state.phaseEndTick = 0;
  return state;
}

/** Park a player on a tile centre so they are out of the way of a test. */
export function placeAt(state: GameState, id: number, tx: number, ty: number): void {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error(`no player ${id}`);
  player.x = tx + 0.5;
  player.y = ty + 0.5;
}

export function armBalloon(
  state: GameState,
  ownerId: number,
  tx: number,
  ty: number,
  range: number,
  fuseTicks: number,
) {
  const balloon = spawnBalloon(state, ownerId, tx, ty, range, fuseTicks, true);
  const owner = state.players.find((p) => p.id === ownerId);
  if (owner) owner.activeBalloons++;
  return balloon;
}

export function input(dir = Dir.NONE, balloonPressed = false, seq = 0, tick = 0): PlayerInput {
  return { seq, tick, dir, balloonPressed };
}

export function noInputs(): Map<number, PlayerInput> {
  return new Map();
}

/** Stable fingerprint of everything the simulation owns. */
export function hashState(state: GameState): string {
  return JSON.stringify({
    tick: state.tick,
    cells: Array.from(state.cells),
    contents: Array.from(state.castleContents),
    players: state.players,
    balloons: state.balloons,
    splashes: state.splashes,
    powerups: state.powerups,
    lobs: state.lobs,
    tideCursor: state.tideCursor,
    phase: state.phase,
    winners: state.winners,
  });
}

export const FUSE = CONFIG.FUSE_TICKS;
