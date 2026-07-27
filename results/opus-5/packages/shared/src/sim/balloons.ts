/** Balloon placement, pass-through bookkeeping, kicking and sliding. */

import { CONFIG } from '../config.js';
import { DIR_VECTORS, Dir, Tile, type Balloon, type DirValue, type GameState, type PlayerState } from '../types.js';
import { balloonAtTile, nextId, overlapsTile, playerTile, tileAt } from './state.js';

export function spawnBalloon(
  state: GameState,
  ownerId: number,
  tx: number,
  ty: number,
  range: number,
  fuseTicks: number,
  counted: boolean,
): Balloon {
  const balloon: Balloon = {
    id: nextId(state),
    ownerId,
    x: tx + 0.5,
    y: ty + 0.5,
    burstTick: state.tick + fuseTicks,
    range,
    slideDir: Dir.NONE,
    passThrough: [],
    counted,
  };
  // Anyone standing on the tile when it appears may walk off it.
  for (const player of state.players) {
    if (player.alive && overlapsTile(player, tx, ty)) balloon.passThrough.push(player.id);
  }
  state.balloons.push(balloon);
  return balloon;
}

/** Drops a balloon on the tile the player occupies, if the rules allow it. */
export function tryPlaceBalloon(state: GameState, player: PlayerState): boolean {
  if (!player.alive) return false;
  if (player.activeBalloons >= player.balloonCount) return false;
  const { tx, ty } = playerTile(player);
  if (tileAt(state, tx, ty) !== Tile.EMPTY) return false;
  if (balloonAtTile(state, tx, ty)) return false;

  const balloon = spawnBalloon(
    state,
    player.id,
    tx,
    ty,
    player.splashRange,
    CONFIG.FUSE_TICKS,
    true,
  );
  player.activeBalloons++;
  state.events.push({ kind: 'balloon_placed', id: balloon.id, playerId: player.id, x: tx, y: ty });
  return true;
}

/** Drop players from `passThrough` once they have fully stepped off. */
export function refreshPassThrough(state: GameState): void {
  for (const balloon of state.balloons) {
    if (balloon.passThrough.length === 0) continue;
    const tx = Math.floor(balloon.x);
    const ty = Math.floor(balloon.y);
    balloon.passThrough = balloon.passThrough.filter((id) => {
      const player = state.players.find((p) => p.id === id);
      return player !== undefined && player.alive && overlapsTile(player, tx, ty);
    });
  }
}

function tileBlocksSlide(state: GameState, tx: number, ty: number, self: Balloon): boolean {
  if (tileAt(state, tx, ty) !== Tile.EMPTY) return true;
  const other = balloonAtTile(state, tx, ty);
  if (other && other.id !== self.id) return true;
  for (const player of state.players) {
    if (player.alive && overlapsTile(player, tx, ty)) return true;
  }
  return false;
}

/**
 * A player with Rubber Boots who walks into a balloon kicks it. The balloon
 * keeps its fuse and slides until something stops it.
 */
export function tryKick(
  state: GameState,
  player: PlayerState,
  dir: DirValue,
  blockedX: number,
  blockedY: number,
): boolean {
  if (!state.kickEnabled || !player.hasKick || dir === Dir.NONE) return false;
  const balloon = balloonAtTile(state, blockedX, blockedY);
  if (!balloon || balloon.slideDir !== Dir.NONE) return false;

  // The critter has to be reasonably lined up with the balloon's lane.
  const horizontal = dir === Dir.LEFT || dir === Dir.RIGHT;
  const offset = horizontal ? Math.abs(player.y - (blockedY + 0.5)) : Math.abs(player.x - (blockedX + 0.5));
  if (offset > CONFIG.KICK_ALIGN_TOLERANCE) return false;

  const [dx, dy] = DIR_VECTORS[dir];
  if (tileBlocksSlide(state, blockedX + dx, blockedY + dy, balloon)) return false;

  balloon.slideDir = dir;
  balloon.passThrough = [];
  state.events.push({ kind: 'balloon_kicked', id: balloon.id, playerId: player.id, dir });
  return true;
}

/** Move sliding balloons tile by tile, snapping to centre when they stop. */
export function updateSlides(state: GameState): void {
  const step = CONFIG.KICK_SPEED / CONFIG.TICK_RATE;
  for (const balloon of state.balloons) {
    if (balloon.slideDir === Dir.NONE) continue;
    const [dx, dy] = DIR_VECTORS[balloon.slideDir];
    let budget = step;

    while (budget > 0) {
      const curTx = Math.floor(balloon.x);
      const curTy = Math.floor(balloon.y);
      const centreX = curTx + 0.5;
      const centreY = curTy + 0.5;
      // Distance until the balloon sits exactly on the next tile centre.
      const toNext = dx !== 0 ? Math.abs(centreX + dx - balloon.x) : Math.abs(centreY + dy - balloon.y);
      // ...and until it crosses the boundary into that tile, which is half a
      // tile sooner. One tick of travel is always shorter than a whole tile, so
      // this is the test that actually stops a slide.
      const toBoundary = toNext - 0.5;
      const nextTx = curTx + dx;
      const nextTy = curTy + dy;

      if (budget < toNext) {
        if (budget > toBoundary && tileBlocksSlide(state, nextTx, nextTy, balloon)) {
          balloon.x = centreX;
          balloon.y = centreY;
          balloon.slideDir = Dir.NONE;
        } else {
          balloon.x += dx * budget;
          balloon.y += dy * budget;
        }
        budget = 0;
        break;
      }

      if (tileBlocksSlide(state, nextTx, nextTy, balloon)) {
        balloon.x = centreX;
        balloon.y = centreY;
        balloon.slideDir = Dir.NONE;
        break;
      }
      balloon.x = nextTx + 0.5;
      balloon.y = nextTy + 0.5;
      budget -= toNext;
    }
  }
}

/** Give the owner their slot back. Safe to call for lob balloons too. */
export function releaseBalloonSlot(state: GameState, balloon: Balloon): void {
  if (!balloon.counted) return;
  const owner = state.players.find((p) => p.id === balloon.ownerId);
  if (owner && owner.activeBalloons > 0) owner.activeBalloons--;
}
