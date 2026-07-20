/**
 * simulateTick — the deterministic heart of Splash Critters.
 * Identical code runs on the server (authority) and client (prediction).
 * Mutates `state`, advances one tick, and returns the events produced this tick.
 */

import { resolveBursts } from './burst';
import { CONFIG } from './config';
import { advanceTide, updateRevenge } from './tide';
import {
  DIR_VECTORS,
  NO_INPUT,
  Tile,
  idx,
  inBounds,
  type Balloon,
  type Dir,
  type GameState,
  type Player,
  type PlayerInput,
  type PowerUpType,
  type SimEvent,
} from './types';

const dt = 1 / CONFIG.TICK_RATE;

function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
}

function balloonAt(state: GameState, x: number, y: number): Balloon | undefined {
  return state.balloons.find((b) => Math.round(b.x) === x && Math.round(b.y) === y);
}

function tileFreeForSlide(state: GameState, x: number, y: number, moving: Balloon): boolean {
  if (!inBounds(x, y, state.width, state.height)) return false;
  if (state.grid[idx(x, y, state.width)] !== Tile.Empty) return false;
  if (state.balloons.some((b) => b.id !== moving.id && Math.round(b.x) === x && Math.round(b.y) === y))
    return false;
  if (state.players.some((p) => p.alive && Math.round(p.x) === x && Math.round(p.y) === y)) return false;
  return true;
}

function tryKick(state: GameState, b: Balloon, dir: Dir, events: SimEvent[]): void {
  const v = DIR_VECTORS[dir];
  const tx = Math.round(b.x) + v.x;
  const ty = Math.round(b.y) + v.y;
  if (!tileFreeForSlide(state, tx, ty, b)) return;
  b.sliding = dir;
  b.slideFrom = { x: Math.round(b.x), y: Math.round(b.y) };
  b.passableOwners = [];
  events.push({ t: 'balloon_kicked', id: b.id, dir, x: Math.round(b.x), y: Math.round(b.y) });
}

function movePlayer(state: GameState, p: Player, dir: Dir, dist: number, events: SimEvent[]): void {
  const v = DIR_VECTORS[dir];
  const horiz = v.x !== 0;
  // auto-center on the cross axis so cornering is responsive
  if (horiz) p.y = approach(p.y, Math.round(p.y), dist);
  else p.x = approach(p.x, Math.round(p.x), dist);

  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  const nextX = cx + v.x;
  const nextY = cy + v.y;

  let canCross = true;
  if (!inBounds(nextX, nextY, state.width, state.height)) {
    canCross = false;
  } else {
    const t = state.grid[idx(nextX, nextY, state.width)];
    if (t === Tile.Boulder || t === Tile.Sandcastle) {
      canCross = false;
    } else {
      const bl = balloonAt(state, nextX, nextY);
      if (bl && !bl.passableOwners.includes(p.id)) {
        canCross = false;
        if (CONFIG.ENABLE_KICK && p.hasKick && bl.sliding === null) tryKick(state, bl, dir, events);
      }
    }
  }

  let np = horiz ? p.x + v.x * dist : p.y + v.y * dist;
  const center = horiz ? cx : cy;
  if (!canCross) {
    if (v.x + v.y > 0) np = Math.min(np, center);
    else np = Math.max(np, center);
  }
  if (horiz) p.x = np;
  else p.y = np;
  p.facing = dir;
  p.moving = true;
}

function tryPlaceBalloon(state: GameState, p: Player, events: SimEvent[]): void {
  if (p.activeBalloons >= p.maxBalloons) return;
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  if (state.grid[idx(tx, ty, state.width)] !== Tile.Empty) return;
  if (balloonAt(state, tx, ty)) return;
  state.balloons.push({
    id: state.nextBalloonId++,
    owner: p.id,
    x: tx,
    y: ty,
    fuseTick: state.tick + CONFIG.FUSE_TICKS,
    range: p.range,
    sliding: null,
    slideFrom: null,
    passableOwners: [p.id],
  });
  p.activeBalloons++;
  events.push({ t: 'balloon_placed', x: tx, y: ty, owner: p.id });
}

function advanceSlidingBalloons(state: GameState): void {
  const step = CONFIG.KICK_SLIDE_TILES_PER_SEC * dt;
  for (const b of state.balloons) {
    if (!b.sliding) continue;
    const v = DIR_VECTORS[b.sliding];
    const curTx = Math.round(b.x);
    const curTy = Math.round(b.y);
    const nx = b.x + v.x * step;
    const ny = b.y + v.y * step;
    if (Math.round(nx) !== curTx || Math.round(ny) !== curTy) {
      if (!tileFreeForSlide(state, Math.round(nx), Math.round(ny), b)) {
        b.x = curTx;
        b.y = curTy;
        b.sliding = null;
        b.slideFrom = null;
        continue;
      }
    }
    b.x = nx;
    b.y = ny;
  }
}

function applyPowerup(p: Player, type: PowerUpType): void {
  switch (type) {
    case 'extraBalloon':
      p.maxBalloons = Math.min(CONFIG.BALLOON_CAP, p.maxBalloons + 1);
      break;
    case 'bigSplash':
      p.range = Math.min(CONFIG.RANGE_CAP, p.range + 1);
      break;
    case 'flippers':
      p.speed = Math.min(CONFIG.SPEED_CAP, p.speed + CONFIG.SPEED_PER_FLIPPER);
      break;
    case 'rubberBoots':
      p.hasKick = true;
      break;
  }
}

function collectPowerups(state: GameState, events: SimEvent[]): void {
  if (!state.powerups.length) return;
  const remaining = [];
  for (const pu of state.powerups) {
    const collector = state.players.find(
      (p) => p.alive && Math.round(p.x) === pu.x && Math.round(p.y) === pu.y,
    );
    if (collector) {
      applyPowerup(collector, pu.type);
      events.push({ t: 'powerup_collected', x: pu.x, y: pu.y, kind: pu.type, playerId: collector.id });
    } else {
      remaining.push(pu);
    }
  }
  state.powerups = remaining;
}

function soakPass(state: GameState, events: SimEvent[]): void {
  const w = state.width;
  const splashByTile = new Map<number, number>();
  for (const s of state.splashes) {
    const i = idx(s.x, s.y, w);
    if (!splashByTile.has(i)) splashByTile.set(i, s.ownerSlot);
  }
  const soakedNow: { p: Player; by: number }[] = [];
  for (const p of state.players) {
    if (!p.alive) continue;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const i = idx(px, py, w);
    let by = -2; // -2 none, -1 tide, >=0 attacker slot
    if (splashByTile.has(i)) by = splashByTile.get(i)!;
    else if (state.grid[i] === Tile.Flooded) by = -1;
    if (by === -2) continue;
    p.alive = false;
    p.soakedTick = state.tick;
    soakedNow.push({ p, by });
    events.push({ t: 'player_soaked', playerId: p.id, bySlot: by, x: px, y: py });
  }
  for (const { p, by } of soakedNow) {
    if (by >= 0) {
      const attacker = state.players.find((a) => a.slot === by);
      if (attacker && attacker.id !== p.id) attacker.soaks++;
    }
    if (state.revengeEnabled) {
      p.revenge = true;
      p.revengeCooldown = CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
    }
  }
}

function cleanupPassable(state: GameState): void {
  for (const b of state.balloons) {
    if (b.passableOwners.length === 0) continue;
    b.passableOwners = b.passableOwners.filter((id) => {
      const pl = state.players.find((p) => p.id === id);
      return !!pl && Math.round(pl.x) === Math.round(b.x) && Math.round(pl.y) === Math.round(b.y);
    });
  }
}

function checkRoundOver(state: GameState): void {
  const alive = state.players.filter((p) => p.alive);
  let end = false;
  if (state.players.length >= 2 && alive.length <= 1) end = true;
  if (state.tick >= CONFIG.ROUND_HARD_CAP_TICKS) end = true;
  if (!end) return;
  state.roundOver = true;
  state.winnerSlot = alive.length === 1 ? alive[0].slot : null;
}

/** Advance the simulation exactly one tick. */
export function simulateTick(state: GameState, inputs: Map<string, PlayerInput>): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.roundOver) return events;
  state.tick++;

  for (const p of state.players) {
    if (!p.alive) continue;
    p.moving = false;
    const input = inputs.get(p.id) ?? NO_INPUT;
    if (input.dir) movePlayer(state, p, input.dir, p.speed * dt, events);
    if (input.balloon) tryPlaceBalloon(state, p, events);
  }

  advanceSlidingBalloons(state);
  resolveBursts(state, events);
  collectPowerups(state, events);
  advanceTide(state, events);
  soakPass(state, events);
  updateRevenge(state, inputs, events);

  if (state.splashes.length) state.splashes = state.splashes.filter((s) => s.expiresTick > state.tick);
  cleanupPassable(state);
  checkRoundOver(state);

  return events;
}

/**
 * Client-side prediction helper: advance ONLY the local player's movement +
 * balloon placement for one tick, against a lightweight state carrying just the
 * grid + balloons. Reuses the exact sim movement rules so prediction matches the
 * server. Returns whether a balloon was placed (for optimistic rendering).
 */
export function predictLocalPlayer(state: GameState, playerId: string, input: PlayerInput): boolean {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p || !p.alive) return false;
  p.moving = false;
  if (input.dir) movePlayer(state, p, input.dir, p.speed * dt, []);
  const before = state.balloons.length;
  if (input.balloon) tryPlaceBalloon(state, p, []);
  return state.balloons.length > before;
}

/** Server-side helper: stamp an emote onto the authoritative state (cosmetic, flows in snapshots). */
export function applyEmote(state: GameState, playerId: string, emoteId: number): void {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return;
  p.emoteId = emoteId;
  p.emoteUntilTick = state.tick + CONFIG.EMOTE_BUBBLE_TICKS;
}
