/**
 * Rising Tide sudden death + Revenge Ducks (casual-only).
 * Both are fully server-simulated and part of the shared deterministic sim.
 */

import { CONFIG } from './config';
import {
  DIR_VECTORS,
  Tile,
  idx,
  inBounds,
  type Dir,
  type GameState,
  type PlayerInput,
  type SimEvent,
} from './types';

const LOB_STEP_TICKS = 4;
const REVENGE_BORDER_SPEED = 0.05; // fraction of the border perimeter per second

/** Chebyshev distance of a tile to the nearest arena edge. */
function ringDistance(x: number, y: number, w: number, h: number): number {
  return Math.min(x, y, w - 1 - x, h - 1 - y);
}

function floodRing(state: GameState, level: number): void {
  const w = state.width;
  const h = state.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ringDistance(x, y, w, h) !== level) continue;
      const i = idx(x, y, w);
      if (state.grid[i] === Tile.Boulder) continue;
      state.grid[i] = Tile.Flooded;
      state.castleContents[i] = null;
    }
  }
  // sweep away power-ups and balloons the water reached
  state.powerups = state.powerups.filter((p) => state.grid[idx(p.x, p.y, w)] !== Tile.Flooded);
}

export function advanceTide(state: GameState, events: SimEvent[]): void {
  if (state.tick < CONFIG.TIDE_START_TICKS) return;
  const since = state.tick - CONFIG.TIDE_START_TICKS;
  const target = 1 + Math.floor(since / CONFIG.TIDE_RING_INTERVAL_TICKS);
  const maxLevel = Math.floor(Math.min(state.width, state.height) / 2);
  while (state.tideLevel < Math.min(target, maxLevel)) {
    state.tideLevel++;
    floodRing(state, state.tideLevel);
    events.push({ t: 'tide_advance', level: state.tideLevel });
  }
}

/** Ordered interior-frame tiles (distance-1 ring) a revenge duck rides around. */
function framePerimeter(w: number, h: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const x0 = 1;
  const y0 = 1;
  const x1 = w - 2;
  const y1 = h - 2;
  for (let x = x0; x <= x1; x++) pts.push({ x, y: y0 });
  for (let y = y0 + 1; y <= y1; y++) pts.push({ x: x1, y });
  for (let x = x1 - 1; x >= x0; x--) pts.push({ x, y: y1 });
  for (let y = y1 - 1; y >= y0 + 1; y--) pts.push({ x: x0, y });
  return pts;
}

function inwardDir(x: number, y: number, w: number, h: number): Dir {
  if (y <= 1) return 'down';
  if (y >= h - 2) return 'up';
  if (x <= 1) return 'right';
  return 'left';
}

function addSplashCell(state: GameState, x: number, y: number, ownerSlot: number): void {
  if (!inBounds(x, y, state.width, state.height)) return;
  state.splashes.push({
    x,
    y,
    expiresTick: state.tick + CONFIG.SPLASH_LINGER_TICKS,
    ownerSlot,
    center: true,
  });
}

/** Move eliminated revenge ducks around the border, fire lobs, and advance active lobs. */
export function updateRevenge(
  state: GameState,
  inputs: Map<string, PlayerInput>,
  events: SimEvent[],
): void {
  if (!state.revengeEnabled) return;
  const w = state.width;
  const h = state.height;
  const perim = framePerimeter(w, h);
  const dtSpeed = REVENGE_BORDER_SPEED / CONFIG.TICK_RATE;

  for (const p of state.players) {
    if (p.alive || !p.revenge) continue;
    p.revengeT = (p.revengeT + dtSpeed) % 1;
    const pt = perim[Math.floor(p.revengeT * perim.length) % perim.length];
    p.x = pt.x;
    p.y = pt.y;
    if (p.revengeCooldown > 0) p.revengeCooldown--;

    const wantsLob = p.isBot ? p.revengeCooldown <= 0 : !!inputs.get(p.id)?.balloon && p.revengeCooldown <= 0;
    if (wantsLob) {
      const dir = inwardDir(pt.x, pt.y, w, h);
      const v = DIR_VECTORS[dir];
      state.revengeLobs.push({
        id: state.nextLobId++,
        owner: p.id,
        x: pt.x + v.x,
        y: pt.y + v.y,
        dir,
        tilesLeft: CONFIG.REVENGE_LOB_TILES,
        stepTick: state.tick + LOB_STEP_TICKS,
      });
      p.revengeCooldown = CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
      events.push({ t: 'revenge_lob', playerId: p.id, x: pt.x, y: pt.y, dir });
    }
  }

  // advance lobs
  const survivors = [];
  for (const lob of state.revengeLobs) {
    if (state.tick < lob.stepTick) {
      survivors.push(lob);
      continue;
    }
    lob.stepTick = state.tick + LOB_STEP_TICKS;
    const owner = state.players.find((pl) => pl.id === lob.owner);
    const ownerSlot = owner ? owner.slot : -1;
    const v = DIR_VECTORS[lob.dir];
    const nx = lob.x + v.x;
    const ny = lob.y + v.y;
    const solid =
      !inBounds(nx, ny, w, h) ||
      state.grid[idx(nx, ny, w)] === Tile.Boulder ||
      state.grid[idx(nx, ny, w)] === Tile.Sandcastle;
    if (solid) {
      addSplashCell(state, lob.x, lob.y, ownerSlot);
      continue; // dropped
    }
    lob.x = nx;
    lob.y = ny;
    lob.tilesLeft--;
    const hitPlayer = state.players.some(
      (pl) => pl.alive && !pl.revenge && Math.round(pl.x) === nx && Math.round(pl.y) === ny,
    );
    if (hitPlayer || lob.tilesLeft <= 0) {
      addSplashCell(state, nx, ny, ownerSlot);
      continue; // dropped
    }
    survivors.push(lob);
  }
  state.revengeLobs = survivors;
}
