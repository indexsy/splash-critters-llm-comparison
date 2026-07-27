/**
 * Bursting, chain cascades and soaking.
 *
 * A cascade is resolved entirely inside a single tick: bursting balloon A
 * enqueues every balloon its splash touches, those enqueue theirs, and so on
 * via BFS. Chained balloons always use their own splashRange.
 */

import { CONFIG } from '../config.js';
import { idx } from '../map.js';
import {
  CARDINALS,
  DIR_VECTORS,
  Tile,
  type Balloon,
  type GameState,
  type PlayerState,
  type Splash,
} from '../types.js';
import { releaseBalloonSlot } from './balloons.js';
import { borderPosFromPoint } from './ducks.js';
import { destroyPowerupsAt, revealPowerup } from './powerups.js';
import { balloonAtTile, nextId, playerTile, tileAt } from './state.js';

/** Retire splashes whose linger time has elapsed. */
export function expireSplashes(state: GameState): void {
  if (state.splashes.length === 0) return;
  state.splashes = state.splashes.filter((s) => s.endTick > state.tick);
}

export function splashCoversTile(splash: Splash, tx: number, ty: number): boolean {
  if (tx === splash.x && ty === splash.y) return true;
  if (tx === splash.x) {
    const dy = ty - splash.y;
    if (dy > 0) return dy <= splash.arms[3];
    return -dy <= splash.arms[1];
  }
  if (ty === splash.y) {
    const dx = tx - splash.x;
    if (dx > 0) return dx <= splash.arms[2];
    return -dx <= splash.arms[4];
  }
  return false;
}

function washCastle(state: GameState, tx: number, ty: number, byPlayerId: number): void {
  state.cells[idx(state.width, tx, ty)] = Tile.EMPTY;
  state.events.push({ kind: 'castle_washed', x: tx, y: ty, byPlayerId });
  const owner = state.players.find((p) => p.id === byPlayerId);
  if (owner) owner.castlesWashed++;
  revealPowerup(state, tx, ty);
}

/**
 * Expand one balloon into a splash. Returns the balloons its arms touched so
 * the caller can continue the cascade.
 */
function detonate(state: GameState, balloon: Balloon): Balloon[] {
  const bx = Math.floor(balloon.x);
  const by = Math.floor(balloon.y);
  const arms: Splash['arms'] = [0, 0, 0, 0, 0];
  const capped: Splash['capped'] = [false, false, false, false, false];
  const chained: Balloon[] = [];

  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    for (let step = 1; step <= balloon.range; step++) {
      const tx = bx + dx * step;
      const ty = by + dy * step;
      const tile = tileAt(state, tx, ty);

      if (tile === Tile.BOULDER || tile === Tile.WATER) {
        capped[dir] = true;
        break;
      }
      if (tile === Tile.CASTLE) {
        // The first sandcastle is washed away and the splash stops there.
        arms[dir] = step;
        capped[dir] = true;
        washCastle(state, tx, ty, balloon.ownerId);
        break;
      }

      arms[dir] = step;
      const other = balloonAtTile(state, tx, ty);
      if (other && other.id !== balloon.id) {
        chained.push(other);
        capped[dir] = true;
        break;
      }
      destroyPowerupsAt(state, tx, ty);
    }
  }

  destroyPowerupsAt(state, bx, by);
  state.splashes.push({
    id: nextId(state),
    ownerId: balloon.ownerId,
    x: bx,
    y: by,
    arms,
    capped,
    endTick: state.tick + CONFIG.SPLASH_TICKS,
  });
  state.events.push({ kind: 'balloon_burst', id: balloon.id, x: bx, y: by });
  return chained;
}

/**
 * Burst everything whose fuse has run out, resolving each independent cascade
 * completely before moving on so chain counts are reported correctly.
 */
export function processBursts(state: GameState): void {
  const due = state.balloons.filter((b) => b.burstTick <= state.tick);
  if (due.length === 0) return;

  const handled = new Set<number>();

  for (const seed of due) {
    if (handled.has(seed.id)) continue;

    const queue: Balloon[] = [seed];
    const inCascade = new Set<number>([seed.id]);
    const order: Balloon[] = [];

    while (queue.length > 0) {
      const balloon = queue.shift() as Balloon;
      order.push(balloon);
      handled.add(balloon.id);
      for (const other of detonate(state, balloon)) {
        if (inCascade.has(other.id)) continue;
        inCascade.add(other.id);
        queue.push(other);
      }
    }

    // Balloons stay in the list during the cascade so arms still stop on them,
    // then the whole cascade is removed at once.
    state.balloons = state.balloons.filter((b) => !inCascade.has(b.id));
    for (const balloon of order) releaseBalloonSlot(state, balloon);

    if (order.length >= 2) {
      const owner = state.players.find((p) => p.id === seed.ownerId);
      if (owner) owner.bestChain = Math.max(owner.bestChain, order.length);
      state.events.push({
        kind: 'chain_burst',
        count: order.length,
        playerId: seed.ownerId,
        x: Math.floor(seed.x),
        y: Math.floor(seed.y),
      });
    }
  }
}

/**
 * The tile you are standing on, exactly like a splash. Using the whole collision
 * box here would drown two critters crowded against the same flooding tile on
 * the same tick, and a simultaneous soak is a drawn round - which made sudden
 * death resolve nothing far too often. Tide.pushOutOfWater keeps the box clear.
 */
function standingInWater(state: GameState, player: PlayerState): boolean {
  const { tx, ty } = playerTile(player);
  return tileAt(state, tx, ty) === Tile.WATER;
}

export function soakPlayer(
  state: GameState,
  player: PlayerState,
  byPlayerId: number,
  byTide: boolean,
): void {
  if (!player.alive) return;
  player.alive = false;
  player.soakedAtTick = state.tick;
  player.moving = false;

  if (!byTide && byPlayerId !== player.id) {
    const attacker = state.players.find((p) => p.id === byPlayerId);
    if (attacker) attacker.soaks++;
  }

  if (state.revengeDucks) {
    player.ghost = true;
    player.ghostPos = borderPosFromPoint(state.width, state.height, player.x, player.y);
    player.ghostCooldown = Math.floor(CONFIG.REVENGE_LOB_COOLDOWN_TICKS / 2);
  }

  state.events.push({
    kind: 'player_soaked',
    playerId: player.id,
    byPlayerId: byTide ? -1 : byPlayerId,
    byTide,
    x: player.x,
    y: player.y,
  });
}

/** The critter having the better round, for the tide's last-one-standing rule. */
function strongestRound(candidates: PlayerState[]): PlayerState {
  let best = candidates[0];
  for (const player of candidates) {
    if (player.soaks !== best.soaks) {
      if (player.soaks > best.soaks) best = player;
      continue;
    }
    if (player.castlesWashed !== best.castlesWashed) {
      if (player.castlesWashed > best.castlesWashed) best = player;
      continue;
    }
    if (player.survivedTicks !== best.survivedTicks) {
      if (player.survivedTicks > best.survivedTicks) best = player;
      continue;
    }
    if (player.id < best.id) best = player;
  }
  return best;
}

/**
 * Everyone standing in a live splash or in the rising tide goes down together,
 * which is how a mutual knockout produces a drawn round.
 *
 * The tide is the one exception. Critters walk through each other, so as the
 * arena closes in they end up sharing tiles, and a single flooding tile was
 * taking the last survivors together and drawing the round. Sudden death exists
 * to break ties, not to make them, so when the water would claim everyone left
 * at once the strongest round survives to win it. A mutual soaking between
 * players still draws, which is the rule players actually feel.
 */
export function resolveSoaks(state: GameState): void {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 0) return;

  const tideVictims: PlayerState[] = [];
  const splashVictims: Array<{ player: PlayerState; by: number }> = [];

  for (const player of alive) {
    if (standingInWater(state, player)) {
      tideVictims.push(player);
      continue;
    }
    const { tx, ty } = playerTile(player);
    for (const splash of state.splashes) {
      if (!splashCoversTile(splash, tx, ty)) continue;
      splashVictims.push({ player, by: splash.ownerId });
      break;
    }
  }

  const spared =
    splashVictims.length === 0 && tideVictims.length === alive.length && alive.length >= 2
      ? strongestRound(tideVictims)
      : null;

  for (const player of tideVictims) {
    if (player === spared) continue;
    soakPlayer(state, player, -1, true);
  }
  for (const victim of splashVictims) {
    soakPlayer(state, victim.player, victim.by, false);
  }
}

/** Balloons and loose power-ups caught by the tide simply dissolve. */
export function washAwayFlooded(state: GameState, tiles: number[]): void {
  if (tiles.length === 0) return;
  const flooded = new Set(tiles);
  state.balloons = state.balloons.filter((balloon) => {
    const i = idx(state.width, Math.floor(balloon.x), Math.floor(balloon.y));
    if (!flooded.has(i)) return true;
    releaseBalloonSlot(state, balloon);
    return false;
  });
  state.powerups = state.powerups.filter(
    (powerup) => !flooded.has(idx(state.width, powerup.x, powerup.y)),
  );
  state.lobs = state.lobs.filter(
    (lob) => !flooded.has(idx(state.width, Math.floor(lob.x), Math.floor(lob.y))),
  );
}
