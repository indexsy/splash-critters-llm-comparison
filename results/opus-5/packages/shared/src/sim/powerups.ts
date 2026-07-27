/** Revealing, collecting and destroying power-ups. */

import { CONFIG } from '../config.js';
import { idx } from '../map.js';
import type { GameState, PlayerState, PowerupType } from '../types.js';
import { nextId, playerTile } from './state.js';

/** Decode the pre-rolled castle contents byte into a power-up type. */
export function decodeContents(code: number): PowerupType | null {
  if (code <= 0 || code > CONFIG.POWERUP_WEIGHTS.length) return null;
  return CONFIG.POWERUP_WEIGHTS[code - 1].type;
}

/**
 * Called the instant a sandcastle is washed away. The contents were fixed at
 * map generation, so nothing random happens here.
 */
export function revealPowerup(state: GameState, tx: number, ty: number): void {
  const i = idx(state.width, tx, ty);
  const type = decodeContents(state.castleContents[i]);
  state.castleContents[i] = 0;
  if (!type) return;
  const powerup = { id: nextId(state), type, x: tx, y: ty };
  state.powerups.push(powerup);
  state.events.push({ kind: 'powerup_revealed', id: powerup.id, type, x: tx, y: ty });
}

export function destroyPowerupsAt(state: GameState, tx: number, ty: number): void {
  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const powerup = state.powerups[i];
    if (powerup.x !== tx || powerup.y !== ty) continue;
    state.powerups.splice(i, 1);
    state.events.push({ kind: 'powerup_destroyed', id: powerup.id, x: tx, y: ty });
  }
}

export function applyPowerup(player: PlayerState, type: PowerupType): void {
  switch (type) {
    case 'extra_balloon':
      player.balloonCount = Math.min(CONFIG.BALLOONS_CAP, player.balloonCount + 1);
      break;
    case 'big_splash':
      player.splashRange = Math.min(CONFIG.RANGE_CAP, player.splashRange + 1);
      break;
    case 'flippers':
      player.speed = Math.min(CONFIG.SPEED_CAP, player.speed + CONFIG.SPEED_PER_FLIPPER);
      break;
    case 'boots':
      // Rubber Boots only ever need granting once per round.
      player.hasKick = true;
      break;
  }
}

/** Pick up anything the critter is standing on. Server authoritative. */
export function collectPowerups(state: GameState): void {
  if (state.powerups.length === 0) return;
  for (const player of state.players) {
    if (!player.alive) continue;
    const { tx, ty } = playerTile(player);
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      const powerup = state.powerups[i];
      if (powerup.x !== tx || powerup.y !== ty) continue;
      state.powerups.splice(i, 1);
      applyPowerup(player, powerup.type);
      state.events.push({
        kind: 'powerup_collected',
        id: powerup.id,
        type: powerup.type,
        playerId: player.id,
      });
    }
  }
}
