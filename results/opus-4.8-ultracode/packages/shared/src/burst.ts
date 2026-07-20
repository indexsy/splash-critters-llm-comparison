/**
 * Balloon burst + splash + chain-cascade resolution.
 * The whole cascade for a tick is resolved here in one pass via a BFS queue
 * with union-find grouping so "DOUBLE/TRIPLE SPLASH" counts are exact.
 */

import { CONFIG } from './config';
import {
  ALL_DIRS,
  DIR_VECTORS,
  Tile,
  idx,
  inBounds,
  type Balloon,
  type GameState,
  type GroundPowerUp,
  type PowerUpType,
  type SimEvent,
} from './types';

interface SplashCellInfo {
  x: number;
  y: number;
  center: boolean;
  castle: boolean;
}

function slotOf(state: GameState, ownerId: string): number {
  const p = state.players.find((pl) => pl.id === ownerId);
  return p ? p.slot : -1;
}

/** Cross-shaped splash for one balloon: origin + arms, blocked by boulders, terminated at the first castle per direction. */
export function computeSplash(state: GameState, b: Balloon): SplashCellInfo[] {
  const w = state.width;
  const h = state.height;
  const ox = Math.round(b.x);
  const oy = Math.round(b.y);
  const cells: SplashCellInfo[] = [{ x: ox, y: oy, center: true, castle: false }];
  for (const dir of ALL_DIRS) {
    const v = DIR_VECTORS[dir];
    for (let step = 1; step <= b.range; step++) {
      const x = ox + v.x * step;
      const y = oy + v.y * step;
      if (!inBounds(x, y, w, h)) break;
      const t = state.grid[idx(x, y, w)];
      if (t === Tile.Boulder) break;
      if (t === Tile.Sandcastle) {
        cells.push({ x, y, center: false, castle: true });
        break;
      }
      cells.push({ x, y, center: false, castle: false });
    }
  }
  return cells;
}

/**
 * Resolve every balloon whose fuse has expired this tick, plus the entire chain
 * cascade they ignite, in a single deterministic pass. Mutates state; pushes events.
 */
export function resolveBursts(state: GameState, events: SimEvent[]): void {
  const tick = state.tick;
  const w = state.width;
  const balloons = state.balloons;

  const burstSet = new Set<number>();
  const queue: Balloon[] = [];
  for (const b of balloons) {
    if (!burstSet.has(b.id) && b.fuseTick <= tick) {
      burstSet.add(b.id);
      queue.push(b);
    }
  }
  if (queue.length === 0) return;

  // union-find over bursting balloons for cascade grouping
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(a) !== r) {
      const next = parent.get(a)!;
      parent.set(a, r);
      a = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const b of queue) parent.set(b.id, b.id);

  const cellInfo = new Map<number, { ownerSlot: number; center: boolean }>();
  const revealed: GroundPowerUp[] = [];
  const burstOrder: Balloon[] = [];

  let qi = 0;
  while (qi < queue.length) {
    const b = queue[qi++];
    burstOrder.push(b);
    const ownerSlot = slotOf(state, b.owner);
    const cells = computeSplash(state, b);
    events.push({
      t: 'balloon_burst',
      x: Math.round(b.x),
      y: Math.round(b.y),
      ownerSlot,
      cells: cells.map((c) => ({ x: c.x, y: c.y })),
    });

    for (const c of cells) {
      const i = idx(c.x, c.y, w);
      const existing = cellInfo.get(i);
      if (existing) existing.center = existing.center || c.center;
      else cellInfo.set(i, { ownerSlot, center: c.center });

      // wash the terminal castle and reveal its pre-rolled contents
      if (c.castle && state.grid[i] === Tile.Sandcastle) {
        state.grid[i] = Tile.Empty;
        const owner = state.players.find((p) => p.id === b.owner);
        if (owner) owner.castlesWashed++;
        events.push({ t: 'castle_washed', x: c.x, y: c.y });
        const content = state.castleContents[i];
        if (content) {
          state.castleContents[i] = null;
          revealed.push({ x: c.x, y: c.y, type: content as PowerUpType });
          events.push({ t: 'powerup_revealed', x: c.x, y: c.y, kind: content as PowerUpType });
        }
      }

      // ignite / merge any balloon sitting on this cell
      for (const other of balloons) {
        if (other.id === b.id) continue;
        if (Math.round(other.x) !== c.x || Math.round(other.y) !== c.y) continue;
        if (!burstSet.has(other.id)) {
          burstSet.add(other.id);
          parent.set(other.id, other.id);
          union(b.id, other.id);
          queue.push(other);
        } else {
          union(b.id, other.id);
        }
      }
    }
  }

  // pre-existing exposed power-ups caught in a splash are destroyed (freshly revealed ones survive this tick)
  state.powerups = state.powerups.filter((p) => !cellInfo.has(idx(p.x, p.y, w)));
  for (const r of revealed) state.powerups.push(r);

  // register lingering splash cells
  for (const [i, info] of cellInfo) {
    const x = i % w;
    const y = Math.floor(i / w);
    state.splashes.push({
      x,
      y,
      expiresTick: tick + CONFIG.SPLASH_LINGER_TICKS,
      ownerSlot: info.ownerSlot,
      center: info.center,
    });
  }

  // chain-burst announcements per cascade component
  const groups = new Map<number, Balloon[]>();
  for (const b of burstOrder) {
    const root = find(b.id);
    let list = groups.get(root);
    if (!list) {
      list = [];
      groups.set(root, list);
    }
    list.push(b);
  }
  for (const list of groups.values()) {
    if (list.length >= 2) {
      const f = list[0];
      events.push({ t: 'chain_burst', count: list.length, x: Math.round(f.x), y: Math.round(f.y) });
    }
  }

  // remove burst balloons; refund each owner an active-balloon slot
  state.balloons = balloons.filter((b) => {
    if (!burstSet.has(b.id)) return true;
    const owner = state.players.find((p) => p.id === b.owner);
    if (owner) owner.activeBalloons = Math.max(0, owner.activeBalloons - 1);
    return false;
  });
}
