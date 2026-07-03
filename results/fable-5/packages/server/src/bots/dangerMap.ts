import {
  CONFIG,
  DIR_VECS,
  TILE,
  isFlooded,
  ringDistance,
  tileAt,
  type Dir,
  type SimBalloon,
  type SimState,
} from "../../../shared/src/index.js";

/**
 * Per-tile danger windows. A tile is lethal during [start, end] (server
 * ticks). Infinity start = never dangerous; Infinity end = permanently
 * dangerous (flood water).
 */
export interface DangerMap {
  start: number[];
  end: number[];
}

/** The tiles a balloon's splash would cover, using burst rules (no washing). */
export function splashTiles(state: SimState, b: { x: number; y: number; range: number }): { x: number; y: number }[] {
  const tiles = [{ x: b.x, y: b.y }];
  for (let dir = 1 as Dir; dir <= 4; dir++) {
    const [dx, dy] = DIR_VECS[dir];
    for (let i = 1; i <= b.range; i++) {
      const tx = b.x + dx * i;
      const ty = b.y + dy * i;
      const tile = tileAt(state, tx, ty);
      if (tile === TILE.BOULDER || tile === TILE.CASTLE) break;
      tiles.push({ x: tx, y: ty });
    }
  }
  return tiles;
}

/**
 * Danger map with CHAIN PROPAGATION: if balloon A's splash covers balloon B,
 * B inherits min(B, A) as its effective burst tick (fixed-point over all
 * pairs). Sliding balloons are marked from their current tile — they re-mark
 * as they move and bots re-evaluate every tick.
 */
export function computeDanger(state: SimState, extraBalloon?: { x: number; y: number; range: number; burstTick: number }): DangerMap {
  const n = state.w * state.h;
  const start = new Array<number>(n).fill(Infinity);
  const end = new Array<number>(n).fill(-Infinity);

  const balloons: { x: number; y: number; range: number; burstTick: number }[] = [
    ...state.balloons,
    ...(extraBalloon ? [extraBalloon] : []),
  ];
  // Sliding (kicked) balloons also threaten from where they will come to rest.
  for (const b of state.balloons) {
    if (!b.slide) continue;
    const [dx, dy] = DIR_VECS[b.slide.dir];
    let rx = b.x;
    let ry = b.y;
    while (true) {
      const nx = rx + dx;
      const ny = ry + dy;
      const t = tileAt(state, nx, ny);
      if (t !== TILE.EMPTY || isFlooded(state, nx, ny)) break;
      if (state.balloons.some((o) => o !== b && o.x === nx && o.y === ny)) break;
      rx = nx;
      ry = ny;
    }
    if (rx !== b.x || ry !== b.y) {
      balloons.push({ x: rx, y: ry, range: b.range, burstTick: b.burstTick });
    }
  }
  const covers = balloons.map((b) => splashTiles(state, b));
  const eff = balloons.map((b) => b.burstTick);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < balloons.length; i++) {
      for (let j = 0; j < balloons.length; j++) {
        if (i === j || eff[j] <= eff[i]) continue;
        if (covers[i].some((t) => t.x === balloons[j].x && t.y === balloons[j].y)) {
          eff[j] = eff[i];
          changed = true;
        }
      }
    }
  }

  for (let i = 0; i < balloons.length; i++) {
    for (const t of covers[i]) {
      const gi = t.y * state.w + t.x;
      start[gi] = Math.min(start[gi], eff[i]);
      end[gi] = Math.max(end[gi], eff[i] + CONFIG.SPLASH_TICKS);
    }
  }

  // Splashes already on the ground.
  for (const s of state.splashes) {
    const gi = s.y * state.w + s.x;
    start[gi] = Math.min(start[gi], state.tick);
    end[gi] = Math.max(end[gi], s.endTick);
  }

  // Flood water is permanently unsafe; the next ring becomes unsafe when the
  // tide advances.
  const tideActive = state.tick >= CONFIG.TIDE_START_TICKS - CONFIG.TIDE_INTERVAL_TICKS * 2;
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const gi = y * state.w + x;
      if (isFlooded(state, x, y)) {
        start[gi] = -Infinity;
        end[gi] = Infinity;
      } else if (tideActive && ringDistance(state, x, y) === state.tideRing) {
        // Will flood on the next advance.
        start[gi] = Math.min(start[gi], Math.max(state.tideNextTick, CONFIG.TIDE_START_TICKS));
        end[gi] = Infinity;
      }
    }
  }

  return { start, end };
}

/** Is it safe to STAND on this tile indefinitely from `arrivalTick` on? */
export function campable(d: DangerMap, gi: number, arrivalTick: number): boolean {
  return d.start[gi] === Infinity || (arrivalTick > d.end[gi] && d.end[gi] !== Infinity);
}

/**
 * Can the tile be passed through at `atTick` (entering + leaving takes
 * `ticksPerTile`)? Requires clearing it before the splash starts, or arriving
 * after it has faded.
 */
export function transitable(d: DangerMap, gi: number, atTick: number, ticksPerTile: number): boolean {
  return atTick + ticksPerTile < d.start[gi] || atTick > d.end[gi];
}
