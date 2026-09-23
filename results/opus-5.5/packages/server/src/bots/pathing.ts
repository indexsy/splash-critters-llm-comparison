// Time-aware path search for bots: Safe Interval Path Planning over tiles. Every tile's future is
// split into dry windows (from the DangerMap); a search state is (tile, dry window) and the value
// is the earliest tick the mover can cross into that tile inside that window, possibly after
// waiting on a dry tile. A path is only valid if every tile is dry the whole time it is occupied.
import { CONFIG, idx, tileCenter, tileOf } from '@splash/shared';
import type { WetWindows } from './dangerMap';

/** Dry windows tracked per tile (later ones are dropped: they lie beyond any useful horizon). */
const MAX_WINDOWS = 6;
const ORIGIN = -2;
const EPS = 1e-6;

export interface Mover {
  x: number;
  y: number;
  /** Sub-units per tick. */
  speed: number;
}

export interface SearchSpec {
  danger: WetWindows;
  /** 1 = the mover cannot enter this tile (boulder, castle, balloon). */
  blocked: Uint8Array;
  mover: Mover;
  /** The mover's first movement happens on tick startTick + 1. */
  startTick: number;
  /** A dry window lasting at least until this tick is campable (safe to stay in). */
  campUntil: number;
  /** Crossings later than this tick are not explored. */
  horizon: number;
  /** Ticks of slack kept before a tile turns wet and after it dries. */
  margin: number;
  /** Stop once this many campable tiles are settled (0 = explore everything within the horizon). */
  stopAfter?: number;
  /** Tiles the mover may not stand still on for longer than a given time. */
  loiter?: Loiter;
  /** The latest tick the mover may cross into each tile (say, before an opponent could block it); none = any. */
  enterBy?: Float64Array;
}

export interface Loiter {
  /** 1 = a tile to leave again within maxTicks of getting there. */
  tiles: Uint8Array;
  maxTicks: number;
}

export interface Route {
  /** Tile indices from the start tile to the goal. */
  tiles: number[];
  /** Planned tick of crossing into tiles[k] (cross[0] = the search start tick). */
  cross: number[];
}

export interface Reach {
  readonly start: number;
  readonly startTick: number;
  /** The mover may simply stay where it is. */
  readonly startCampable: boolean;
  /** Earliest planned crossing into a campable window per tile (Infinity = none). */
  readonly campAt: Float64Array;
  /** Campable tiles in settling order (nearest in time first); includes the start tile if campable. */
  readonly campTiles: number[];
  /** Earliest crossing into any dry window per tile (Infinity = unreachable). */
  readonly anyAt: Float64Array;
  /**
   * The latest tick the mover can stay dry until (exclusive): the end of the latest dry window it
   * can reach (Infinity if one never ends). A lower bound when the search stopped early.
   */
  readonly lastDry: number;
  /**
   * Route to a tile's campable window (or its earliest window if not campable); with `first`, to
   * its earliest reachable window even when a later one is campable. Null if unreachable.
   */
  routeTo(tile: number, first?: boolean): Route | null;
  /**
   * Does `test` hold for some step of routeTo(tile, first) (entering `to` from `from` on tick
   * `cross`)? Walks the route without building it; false for an unreachable tile.
   */
  routeHas(tile: number, test: (to: number, cross: number, from: number) => boolean, first?: boolean): boolean;
}

/** Distance (sub-units) from the mover's position to the boundary of the neighbour tile in each direction. */
function firstLegDistances(m: Mover, w: number): { start: number; legs: number[] } {
  const tx = tileOf(m.x);
  const ty = tileOf(m.y);
  const offX = m.x - tileCenter(tx);
  const offY = m.y - tileCenter(ty);
  const half = CONFIG.SUB / 2;
  // [up, down, left, right]: perpendicular re-centering first, then the rest of the half tile.
  const legs = [
    Math.abs(offX) + half + offY,
    Math.abs(offX) + half - offY,
    Math.abs(offY) + half + offX,
    Math.abs(offY) + half - offX,
  ];
  return { start: idx(w, tx, ty), legs };
}

/** Binary min-heap of (time, key) pairs in parallel arrays. */
class MinHeap {
  private times: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(time: number, key: number): void {
    const times = this.times;
    const keys = this.keys;
    let i = keys.length;
    times.push(time);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (times[parent] <= time) break;
      times[i] = times[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    times[i] = time;
    keys[i] = key;
  }

  /** Removes the minimum; returns its key (time via `lastTime`). */
  pop(): number {
    const times = this.times;
    const keys = this.keys;
    const key = keys[0];
    this.lastTime = times[0];
    const t = times.pop() as number;
    const k = keys.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && times[r] < times[l] ? r : l;
        if (times[c] >= t) break;
        times[i] = times[c];
        keys[i] = keys[c];
        i = c;
      }
      times[i] = t;
      keys[i] = k;
    }
    return key;
  }

  lastTime = 0;
}

const UNBUILT = 255;

/**
 * Working memory of one search that nothing returned from it refers to. Searches never nest
 * (building windows only reads the danger map), so one set per arena size is reused.
 */
interface Scratch {
  n: number;
  best: Float64Array;
  closed: Uint8Array;
  startAt: Float64Array;
  endAt: Float64Array;
  counts: Uint8Array;
}

let scratch: Scratch | null = null;

/** The reusable working memory for an arena of `n` tiles, reset for a new search. */
function scratchFor(n: number): Scratch {
  if (scratch === null || scratch.n !== n) {
    const keys = n * MAX_WINDOWS;
    scratch = {
      n,
      best: new Float64Array(keys),
      closed: new Uint8Array(keys),
      startAt: new Float64Array(keys),
      endAt: new Float64Array(keys),
      counts: new Uint8Array(n),
    };
  }
  scratch.best.fill(Infinity);
  scratch.closed.fill(0);
  scratch.counts.fill(UNBUILT);
  return scratch;
}

/** Dry windows per tile, starting at `from` (exclusive ends; Infinity = dry for good), built on first use. */
class Windows {
  private readonly startAt: Float64Array;
  private readonly endAt: Float64Array;
  private readonly counts: Uint8Array;

  constructor(
    private readonly danger: WetWindows,
    private readonly from: number,
    memory: Scratch,
  ) {
    this.startAt = memory.startAt;
    this.endAt = memory.endAt;
    this.counts = memory.counts;
  }

  count(tile: number): number {
    const c = this.counts[tile];
    return c === UNBUILT ? this.build(tile) : c;
  }

  start(key: number): number {
    return this.startAt[key];
  }

  end(key: number): number {
    return this.endAt[key];
  }

  private build(tile: number): number {
    const wet = this.danger.intervals(tile);
    let cur = this.from;
    let c = 0;
    const base = tile * MAX_WINDOWS;
    for (let k = 0; k < wet.length && c < MAX_WINDOWS; k += 2) {
      if (wet[k + 1] <= cur) continue;
      if (wet[k] > cur) {
        this.startAt[base + c] = cur;
        this.endAt[base + c] = wet[k];
        c++;
      }
      cur = Math.max(cur, wet[k + 1]);
    }
    if (cur !== Infinity && c < MAX_WINDOWS) {
      this.startAt[base + c] = cur;
      this.endAt[base + c] = Infinity;
      c++;
    }
    this.counts[tile] = c;
    return c;
  }

  /** Index of the window containing tick t on a tile, or -1. */
  containing(tile: number, t: number): number {
    const base = tile * MAX_WINDOWS;
    const count = this.count(tile);
    for (let j = 0; j < count; j++) {
      if (this.startAt[base + j] <= t && t < this.endAt[base + j]) return j;
    }
    return -1;
  }
}

/** Earliest-arrival search from the mover's position through dry windows. */
export function searchReach(spec: SearchSpec): Reach {
  const { danger, blocked, mover, startTick, margin } = spec;
  const { loiter, enterBy } = spec;
  const w = danger.w;
  const n = danger.w * danger.h;
  const first = startTick + 1;
  const memory = scratchFor(n);
  const win = new Windows(danger, first, memory);
  const { start, legs } = firstLegDistances(mover, w);
  const { best, closed } = memory;
  const crossTick = new Float64Array(n * MAX_WINDOWS);
  const parent = new Int32Array(n * MAX_WINDOWS).fill(-1);
  const campAt = new Float64Array(n).fill(Infinity);
  const campKey = new Int32Array(n).fill(-1);
  const anyAt = new Float64Array(n).fill(Infinity);
  const anyKey = new Int32Array(n).fill(-1);
  const campTiles: number[] = [];
  const heap = new MinHeap();
  const stepTime = CONFIG.SUB / mover.speed;

  const originWindow = win.containing(start, first);
  const originEnd = originWindow >= 0 ? win.end(start * MAX_WINDOWS + originWindow) : first;
  const startCampable = originWindow >= 0 && originEnd >= spec.campUntil;
  let lastDry = originEnd;
  anyAt[start] = startTick;
  if (startCampable) {
    campAt[start] = startTick;
    campTiles.push(start);
  }

  // `firstLegs`: sub-units to each neighbour from the mover's own position (the origin only).
  const relax = (from: number, fromKey: number, fromTime: number, exitLimit: number, firstLegs: readonly number[] | null): void => {
    const fx = from % w;
    const fy = (from - fx) / w;
    for (let a = 0; a < 4; a++) {
      const tx = fx + (a === 2 ? -1 : a === 3 ? 1 : 0);
      const ty = fy + (a === 0 ? -1 : a === 1 ? 1 : 0);
      if (tx < 0 || ty < 0 || tx >= w || ty >= danger.h) continue;
      const to = ty * w + tx;
      if (blocked[to] === 1) continue;
      const arrive = fromTime + (firstLegs ? firstLegs[a] / mover.speed : stepTime);
      const earliest = Math.ceil(arrive - EPS);
      if (earliest > exitLimit || earliest > spec.horizon) continue;
      // Waiting on `from` until crossing on tick c: at most loiter.maxTicks past the earliest crossing.
      const waitLimit = loiter !== undefined && loiter.tiles[from] === 1 ? arrive + loiter.maxTicks : Infinity;
      const base = to * MAX_WINDOWS;
      const count = win.count(to);
      for (let j = 0; j < count; j++) {
        const ws = win.start(base + j);
        const we = win.end(base + j);
        const c = Math.max(earliest, ws > first ? ws + margin : ws);
        if (c > exitLimit || c > spec.horizon || c > waitLimit) break;
        if (enterBy !== undefined && c > enterBy[to]) break;
        if (c >= we - margin) continue;
        const time = c > earliest ? c : arrive;
        const key = base + j;
        if (time + EPS >= best[key]) continue;
        best[key] = time;
        crossTick[key] = c;
        parent[key] = fromKey;
        heap.push(time, key);
      }
    }
  };

  const originExit = originWindow >= 0 ? originEnd - margin : first;
  relax(start, ORIGIN, startTick, originExit, legs);

  let settledCamp = campTiles.length;
  while (heap.size > 0) {
    const key = heap.pop();
    if (closed[key] === 1) continue;
    closed[key] = 1;
    const time = heap.lastTime;
    const tile = (key / MAX_WINDOWS) | 0;
    const c = crossTick[key];
    if (c < anyAt[tile]) {
      anyAt[tile] = c;
      anyKey[tile] = key;
    }
    const end = win.end(key);
    if (end > lastDry) lastDry = end;
    if (end >= spec.campUntil && c < campAt[tile]) {
      if (campAt[tile] === Infinity) {
        campTiles.push(tile);
        settledCamp++;
      }
      campAt[tile] = c;
      campKey[tile] = key;
      if (spec.stopAfter && settledCamp >= spec.stopAfter) break;
    }
    relax(tile, key, time, end - margin, null);
  }

  /** Search key of the window a route to `tile` ends in: -1 = the start itself, -2 = unreachable. */
  const routeKey = (tile: number, first: boolean): number => {
    if (tile === start && (first || startCampable || campKey[tile] < 0)) return -1;
    const key = campKey[tile] >= 0 && !first ? campKey[tile] : anyKey[tile];
    return key < 0 ? -2 : key;
  };

  const routeTo = (tile: number, first = false): Route | null => {
    const key = routeKey(tile, first);
    if (key === -1) return { tiles: [start], cross: [startTick] };
    if (key < 0) return null;
    const tiles: number[] = [];
    const cross: number[] = [];
    for (let k = key; k !== ORIGIN; k = parent[k]) {
      tiles.push((k / MAX_WINDOWS) | 0);
      cross.push(crossTick[k]);
    }
    tiles.push(start);
    cross.push(startTick);
    tiles.reverse();
    cross.reverse();
    return { tiles, cross };
  };

  const routeHas = (tile: number, test: (to: number, cross: number, from: number) => boolean, first = false): boolean => {
    for (let k = routeKey(tile, first); k >= 0; k = parent[k]) {
      const from = parent[k] === ORIGIN ? start : (parent[k] / MAX_WINDOWS) | 0;
      if (test((k / MAX_WINDOWS) | 0, crossTick[k], from)) return true;
    }
    return false;
  };

  return { start, startTick, startCampable, campAt, campTiles, anyAt, lastDry, routeTo, routeHas };
}
