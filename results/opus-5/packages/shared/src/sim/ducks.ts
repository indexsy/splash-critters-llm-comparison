/**
 * Revenge Ducks - soaked critters paddle around the arena border on a rubber
 * duck and can lob a balloon straight in every few seconds. Casual only.
 */

import { CONFIG } from '../config.js';
import {
  DIR_VECTORS,
  Dir,
  Tile,
  type DirValue,
  type GameState,
  type PlayerInput,
  type PlayerState,
} from '../types.js';
import { spawnBalloon } from './balloons.js';
import { balloonAtTile, nextId, tileAt } from './state.js';

/** Number of border tiles in the ring. */
export function perimeterLength(width: number, height: number): number {
  return 2 * width + 2 * height - 4;
}

/** Border tile at an integer perimeter offset, walking clockwise from (0,0). */
export function perimeterTile(width: number, height: number, pos: number): { x: number; y: number } {
  const total = perimeterLength(width, height);
  const p = ((Math.round(pos) % total) + total) % total;
  if (p < width) return { x: p, y: 0 };
  if (p < width + height - 1) return { x: width - 1, y: p - (width - 1) };
  if (p < 2 * width + height - 2) return { x: width - 1 - (p - (width + height - 2)), y: height - 1 };
  return { x: 0, y: height - 1 - (p - (2 * width + height - 3)) };
}

/** Smoothly interpolated border position, for rendering the paddling duck. */
export function perimeterPoint(width: number, height: number, pos: number): { x: number; y: number } {
  const total = perimeterLength(width, height);
  const p = ((pos % total) + total) % total;
  const base = Math.floor(p);
  const frac = p - base;
  const a = perimeterTile(width, height, base);
  const b = perimeterTile(width, height, base + 1);
  return { x: a.x + (b.x - a.x) * frac + 0.5, y: a.y + (b.y - a.y) * frac + 0.5 };
}

/** Closest border position to an arbitrary arena point. */
export function borderPosFromPoint(width: number, height: number, x: number, y: number): number {
  const total = perimeterLength(width, height);
  let bestPos = 0;
  let bestDist = Infinity;
  for (let p = 0; p < total; p++) {
    const tile = perimeterTile(width, height, p);
    const dx = tile.x + 0.5 - x;
    const dy = tile.y + 0.5 - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestPos = p;
    }
  }
  return bestPos;
}

/** Which way is "into the arena" from this border tile? */
export function inwardDir(width: number, height: number, pos: number): DirValue {
  const tile = perimeterTile(width, height, pos);
  if (tile.y === 0) return Dir.DOWN;
  if (tile.y === height - 1) return Dir.UP;
  if (tile.x === 0) return Dir.RIGHT;
  return Dir.LEFT;
}

/** Paddle along the border and fire lobs. */
export function updateGhosts(state: GameState, inputs: Map<number, PlayerInput>): void {
  if (!state.revengeDucks) return;
  const speed = CONFIG.DUCK_SPEED / CONFIG.TICK_RATE;
  const total = perimeterLength(state.width, state.height);

  for (const player of state.players) {
    if (player.alive || !player.ghost) continue;
    if (player.ghostCooldown > 0) player.ghostCooldown--;

    const input = inputs.get(player.id);
    if (!input) continue;

    if (input.dir === Dir.RIGHT || input.dir === Dir.DOWN) {
      player.ghostPos = (player.ghostPos + speed) % total;
    } else if (input.dir === Dir.LEFT || input.dir === Dir.UP) {
      player.ghostPos = (player.ghostPos - speed + total) % total;
    }

    if (input.balloonPressed && player.ghostCooldown === 0) {
      if (fireLob(state, player)) player.ghostCooldown = CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
    }
  }
}

function fireLob(state: GameState, player: PlayerState): boolean {
  const dir = inwardDir(state.width, state.height, player.ghostPos);
  const start = perimeterTile(state.width, state.height, player.ghostPos);
  const [dx, dy] = DIR_VECTORS[dir];

  // Nothing to lob onto if the whole lane is walled off.
  let landable = 0;
  for (let step = 1; step <= CONFIG.REVENGE_LOB_TILES; step++) {
    const tx = start.x + dx * step;
    const ty = start.y + dy * step;
    if (tileAt(state, tx, ty) !== Tile.EMPTY) break;
    if (balloonAtTile(state, tx, ty)) break;
    landable = step;
  }
  if (landable === 0) return false;

  state.lobs.push({
    id: nextId(state),
    ownerId: player.id,
    x: start.x + 0.5,
    y: start.y + 0.5,
    dir,
    remaining: landable,
  });
  state.events.push({
    kind: 'revenge_lob',
    playerId: player.id,
    x: start.x,
    y: start.y,
    dir,
  });
  return true;
}

/** Fly lobs inward; on landing they become a short-fused balloon. */
export function updateLobs(state: GameState): void {
  if (state.lobs.length === 0) return;
  const step = CONFIG.REVENGE_LOB_SPEED / CONFIG.TICK_RATE;

  for (let i = state.lobs.length - 1; i >= 0; i--) {
    const lob = state.lobs[i];
    const [dx, dy] = DIR_VECTORS[lob.dir];
    const travel = Math.min(step, lob.remaining);
    lob.x += dx * travel;
    lob.y += dy * travel;
    lob.remaining -= travel;
    if (lob.remaining > 0) continue;

    state.lobs.splice(i, 1);
    const tx = Math.floor(lob.x);
    const ty = Math.floor(lob.y);
    if (tileAt(state, tx, ty) !== Tile.EMPTY || balloonAtTile(state, tx, ty)) continue;
    const balloon = spawnBalloon(
      state,
      lob.ownerId,
      tx,
      ty,
      CONFIG.REVENGE_LOB_RANGE,
      CONFIG.REVENGE_LOB_FUSE_TICKS,
      false,
    );
    state.events.push({ kind: 'balloon_placed', id: balloon.id, playerId: lob.ownerId, x: tx, y: ty });
  }
}
