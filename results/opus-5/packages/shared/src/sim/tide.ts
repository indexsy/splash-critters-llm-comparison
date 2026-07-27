/**
 * Rising Tide sudden death: from 2:00 the arena floods inward one ring at a
 * time. Flooded tiles are solid, lethal, and dissolve anything sitting on them.
 */

import { CONFIG } from '../config.js';
import { Tile, type GameState } from '../types.js';
import { washAwayFlooded } from './splash.js';
import { playerTile, tileAt } from './state.js';

/**
 * Rising water shoves critters off the tiles it takes instead of letting them
 * clip into it. Only the tile under a critter's centre is lethal, so without
 * this nudge a sprite could stand half inside the sea.
 */
function pushOutOfWater(state: GameState): void {
  const r = CONFIG.PLAYER_RADIUS;
  const eps = CONFIG.COLLISION_EPSILON;
  for (const player of state.players) {
    if (!player.alive) continue;
    const { tx, ty } = playerTile(player);
    // Standing in it already: they go under this tick, so leave them be.
    if (tileAt(state, tx, ty) === Tile.WATER) continue;
    if (tileAt(state, tx - 1, ty) === Tile.WATER) player.x = Math.max(player.x, tx + r + eps);
    if (tileAt(state, tx + 1, ty) === Tile.WATER) player.x = Math.min(player.x, tx + 1 - r - eps);
    if (tileAt(state, tx, ty - 1) === Tile.WATER) player.y = Math.max(player.y, ty + r + eps);
    if (tileAt(state, tx, ty + 1) === Tile.WATER) player.y = Math.min(player.y, ty + 1 - r - eps);
  }
}

/** Ticks until the first tile floods; negative once the tide has started. */
export function ticksUntilTide(state: GameState): number {
  return CONFIG.TIDE_START_TICKS - state.tick;
}

export function advanceTide(state: GameState): void {
  if (state.tick === CONFIG.TIDE_START_TICKS - CONFIG.TIDE_WARNING_TICKS) {
    state.events.push({ kind: 'tide_warning' });
  }
  if (state.tideCursor >= state.tideOrder.length) return;

  const flooded: number[] = [];
  while (
    state.tideCursor < state.tideOrder.length &&
    state.tideTicks[state.tideCursor] <= state.tick
  ) {
    const i = state.tideOrder[state.tideCursor];
    state.tideCursor++;
    if (state.cells[i] === Tile.WATER) continue;
    state.cells[i] = Tile.WATER;
    state.castleContents[i] = 0;
    flooded.push(i);
  }

  if (flooded.length === 0) return;
  washAwayFlooded(state, flooded);
  pushOutOfWater(state);
  state.events.push({ kind: 'tide_advance', tiles: flooded });
}
