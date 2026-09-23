// Future-burst simulation behind the bots' danger map. It replays every pending balloon forward
// in time without moving any player: fuses, chain cascades (a balloon reached by a splash bursts
// in the same tick), castles washed between burst phases, balloons fizzled by the rising tide and
// kicked balloons sliding to their resting tile. The output is, per tile, the tick windows during
// which the tile will be wet. Only public state is read (never `hidden`).
import {
  ALL_DIRS,
  CONFIG,
  DIR_DX,
  DIR_DY,
  Dir,
  Tile,
  idx,
  inBounds,
  maxTideLevel,
  ringIndex,
  tileCenter,
  tileOf,
  type Balloon,
  type RoundState,
} from '@splash/shared';

/** Wet-window kinds. Visible water and the tide are always perceived exactly (see DangerMap.perceivedBy). */
export const WetKind = { Cascade: 0, Lingering: 1, SlideSweep: 2 } as const;

/** A balloon that has not burst yet, as the simulation sees it. */
export interface PendingBalloon {
  id: number;
  owner: number;
  range: number;
  burstTick: number;
  /**
   * Tiles the balloon occupies over time: path[k] from tick enter[k] on. A resting balloon has a
   * single entry; a kicked one lists every tile of its projected slide (the last is where it rests).
   */
  path: number[];
  enter: number[];
}


/** Everything the simulation needs, captured once per tick so hypotheticals can be re-run cheaply. */
export interface DangerInput {
  w: number;
  h: number;
  tick: number;
  nextId: number;
  tiles: Uint8Array;
  balloons: PendingBalloon[];
  /** Tick from which each tile is flooded for good (Infinity = never, -Infinity = already). */
  floodTick: Float64Array;
  /** Tick the innermost ring floods (the whole arena is under water from then on); Infinity without tide. */
  lastFlood: number;
  /** Existing lingering splash: exclusive end tick per tile (0 = dry). */
  lingerUntil: Int32Array;
  lingerOwner: Int8Array;
  /** Wet windows of tiles only the tide touches, shared by every map built on this input. */
  tideOnly: (readonly number[] | undefined)[];
}

/** Raw wet windows per tile, flattened as [from, until, owners | kind << 8, ...]. */
export type RawWet = (number[] | undefined)[];

export interface DangerResult {
  wet: RawWet;
  /** Effective (chain-aware) burst tick per balloon id; fizzled balloons are absent. */
  burstTicks: Map<number, number>;
}

/** Captures the public state that drives future bursts. */
export function prepareDangerInput(s: RoundState): DangerInput {
  const n = s.w * s.h;
  const lingerUntil = new Int32Array(n);
  const lingerOwner = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (s.splashUntil[i] > s.tick + 1) {
      lingerUntil[i] = s.splashUntil[i];
      lingerOwner[i] = s.splashOwner[i];
    }
  }
  const balloons = s.balloons.map((b) => toPending(s, b, lingerUntil));
  const floodTick = computeFloodTicks(s);
  let lastFlood = -Infinity;
  for (const f of floodTick) if (f !== Infinity && f > lastFlood) lastFlood = f;
  return {
    w: s.w,
    h: s.h,
    tick: s.tick,
    nextId: s.nextId,
    tiles: s.tiles.slice(),
    balloons,
    floodTick,
    lastFlood: s.rules.tide ? lastFlood : Infinity,
    lingerUntil,
    lingerOwner,
    tideOnly: new Array(n),
  };
}

/** A balloon sitting in lingering water bursts on the very next tick. */
function toPending(s: RoundState, b: Balloon, lingerUntil: Int32Array): PendingBalloon {
  if (b.slideDir !== Dir.None) return projectSlide(s, b);
  const tile = idx(s.w, b.tx, b.ty);
  const next = s.tick + 1;
  const burstTick = lingerUntil[tile] > next ? next : Math.max(b.burstTick, next);
  return { id: b.id, owner: b.owner, range: b.range, burstTick, path: [tile], enter: [s.tick] };
}

/**
 * Follows a kicked balloon tick by tick with the sim's slide rules (1000 units per tick, stops
 * in front of a castle, boulder, balloon or a player's current tile) until it rests or its fuse
 * ends; it bursts early if it slides into lingering water.
 */
function projectSlide(s: RoundState, b: Balloon): PendingBalloon {
  const horizontal = DIR_DX[b.slideDir] !== 0;
  const d = DIR_DX[b.slideDir] + DIR_DY[b.slideDir];
  const unitsPerTick = Math.round((CONFIG.KICK_SPEED * CONFIG.SUB) / CONFIG.TICK_RATE);
  let x = b.x;
  let y = b.y;
  const path: number[] = [idx(s.w, b.tx, b.ty)];
  const enter: number[] = [s.tick];
  let burstTick = Math.max(b.burstTick, s.tick + 1);
  for (let t = s.tick + 1; t <= burstTick; t++) {
    let budget = unitsPerTick;
    let stopped = false;
    while (budget > 0) {
      const pos = horizontal ? x : y;
      const tile = tileOf(pos);
      const center = tileCenter(tile);
      let goal = center;
      if ((center - pos) * d <= 0) {
        const nx = horizontal ? tile + d : tileOf(x);
        const ny = horizontal ? tileOf(y) : tile + d;
        if (!slideTargetFree(s, b, nx, ny)) {
          stopped = true;
          break;
        }
        goal = tileCenter(tile + d);
      }
      const step = Math.min(budget, Math.abs(goal - pos));
      if (horizontal) x = pos + d * step;
      else y = pos + d * step;
      budget -= step;
    }
    const here = idx(s.w, tileOf(x), tileOf(y));
    if (path[path.length - 1] !== here) {
      path.push(here);
      enter.push(t);
    }
    if (s.splashUntil[here] > t) burstTick = t;
    if (stopped) break;
  }
  return { id: b.id, owner: b.owner, range: b.range, burstTick, path, enter };
}

function slideTargetFree(s: RoundState, self: Balloon, tx: number, ty: number): boolean {
  if (!inBounds(s.w, s.h, tx, ty) || s.tiles[idx(s.w, tx, ty)] !== Tile.Floor) return false;
  for (const o of s.balloons) if (o !== self && o.tx === tx && o.ty === ty) return false;
  for (const p of s.players) {
    if (p.present && p.alive && tileOf(p.x) === tx && tileOf(p.y) === ty) return false;
  }
  return true;
}

/** Ring r floods at nextTideTick + (r - tideLevel - 1) * interval; rings <= tideLevel already are. */
function computeFloodTicks(s: RoundState): Float64Array {
  const flood = new Float64Array(s.w * s.h).fill(Infinity);
  if (!s.rules.tide) return flood;
  const maxLevel = maxTideLevel(s.w, s.h);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const ring = ringIndex(s.w, s.h, x, y);
      if (ring < 1 || ring > maxLevel) continue;
      const i = idx(s.w, x, y);
      if (ring <= s.tideLevel) flood[i] = -Infinity;
      else flood[i] = s.nextTideTick + (ring - s.tideLevel - 1) * CONFIG.TIDE_INTERVAL_TICKS;
    }
  }
  return flood;
}

// ---------------------------------------------------------------------------
// The simulation proper
// ---------------------------------------------------------------------------

const PENDING = 0;
const QUEUED = 1;
const GONE = 2;

interface SimScratch {
  input: DangerInput;
  list: PendingBalloon[];
  tiles: Uint8Array;
  status: Uint8Array;
  burstAt: Float64Array;
  /** Index into each balloon's path of the tile it occupies at the current phase. */
  loc: Int16Array;
  /** Tile index -> index into `list` of the balloon occupying it (-1 = none). */
  at: Int16Array;
  wet: RawWet;
}

/** Runs every pending balloon (plus `extra`, a hypothetical) forward and returns the wet windows. */
export function simulateDanger(input: DangerInput, extras: readonly PendingBalloon[] = []): DangerResult {
  const list = extras.length > 0 ? [...input.balloons, ...extras] : input.balloons;
  const sim: SimScratch = {
    input,
    list,
    tiles: input.tiles.slice(),
    status: new Uint8Array(list.length),
    burstAt: new Float64Array(list.length),
    loc: new Int16Array(list.length),
    at: new Int16Array(input.w * input.h).fill(-1),
    wet: new Array(input.w * input.h),
  };
  list.forEach((b, k) => {
    sim.burstAt[k] = b.burstTick;
    const tile = b.path[0];
    if (sim.at[tile] < 0 || list[sim.at[tile]].id > b.id) sim.at[tile] = k;
  });
  addLingering(sim);
  const burstTicks = new Map<number, number>();
  for (;;) {
    const tb = nextPhaseTick(sim);
    if (tb === Infinity) break;
    advanceSliders(sim, tb);
    fizzleFlooded(sim, tb);
    runPhase(sim, tb, burstTicks);
  }
  return { wet: sim.wet, burstTicks };
}

function pushWet(wet: RawWet, tile: number, from: number, until: number, owners: number, kind: number): void {
  const arr = wet[tile] ?? (wet[tile] = []);
  arr.push(from, until, owners | (kind << 8));
}

function addLingering(sim: SimScratch): void {
  const { lingerUntil, lingerOwner, tick } = sim.input;
  for (let i = 0; i < lingerUntil.length; i++) {
    if (lingerUntil[i] === 0) continue;
    const owners = lingerOwner[i] >= 0 ? 1 << lingerOwner[i] : 0;
    pushWet(sim.wet, i, tick + 1, lingerUntil[i], owners, WetKind.Lingering);
  }
}

function nextPhaseTick(sim: SimScratch): number {
  let tb = Infinity;
  for (let k = 0; k < sim.list.length; k++) if (sim.status[k] === PENDING && sim.burstAt[k] < tb) tb = sim.burstAt[k];
  return tb;
}

function tileOfBalloon(sim: SimScratch, k: number): number {
  return sim.list[k].path[sim.loc[k]];
}

/** Moves kicked balloons along their projected slide to where they are on tick tb. */
function advanceSliders(sim: SimScratch, tb: number): void {
  for (let k = 0; k < sim.list.length; k++) {
    const b = sim.list[k];
    if (sim.status[k] !== PENDING || b.path.length === 1) continue;
    let j = sim.loc[k];
    while (j + 1 < b.path.length && b.enter[j + 1] <= tb) j++;
    if (j === sim.loc[k]) continue;
    const from = tileOfBalloon(sim, k);
    if (sim.at[from] === k) sim.at[from] = -1;
    sim.loc[k] = j;
    if (sim.at[b.path[j]] < 0) sim.at[b.path[j]] = k;
  }
}

/** A kicked balloon sliding into splash water painted at tb bursts the tick it arrives there. */
function soakSliders(sim: SimScratch, painted: ReadonlySet<number>, tb: number): void {
  const until = tb + CONFIG.SPLASH_TICKS;
  for (let k = 0; k < sim.list.length; k++) {
    const b = sim.list[k];
    if (sim.status[k] !== PENDING || b.path.length === 1) continue;
    for (let j = sim.loc[k] + 1; j < b.path.length && b.enter[j] < until; j++) {
      if (!painted.has(b.path[j])) continue;
      sim.burstAt[k] = Math.min(sim.burstAt[k], b.enter[j]);
      break;
    }
  }
}

/** Bursts happen before the tide in a tick, so a balloon fizzles only if flooded strictly earlier. */
function fizzleFlooded(sim: SimScratch, tb: number): void {
  for (let k = 0; k < sim.list.length; k++) {
    if (sim.status[k] !== PENDING) continue;
    if (sim.input.floodTick[tileOfBalloon(sim, k)] < tb) removeBalloon(sim, k);
  }
}

function removeBalloon(sim: SimScratch, k: number): void {
  sim.status[k] = GONE;
  const tile = tileOfBalloon(sim, k);
  if (sim.at[tile] === k) sim.at[tile] = -1;
}

/** One burst phase: seeds in id order, each cascading BFS-style; castles wash after the phase. */
function runPhase(sim: SimScratch, tb: number, burstTicks: Map<number, number>): void {
  const seeds: number[] = [];
  for (let k = 0; k < sim.list.length; k++) if (sim.status[k] === PENDING && sim.burstAt[k] === tb) seeds.push(k);
  seeds.sort((a, b) => sim.list[a].id - sim.list[b].id);
  const washed: number[] = [];
  for (const seed of seeds) {
    if (sim.status[seed] !== PENDING) continue;
    runCascade(sim, seed, tb, washed, burstTicks);
  }
  for (const i of washed) sim.tiles[i] = Tile.Floor;
}

function runCascade(sim: SimScratch, seed: number, tb: number, washed: number[], burstTicks: Map<number, number>): void {
  const queue = [seed];
  sim.status[seed] = QUEUED;
  const painted = new Set<number>();
  let owners = 0;
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const b = sim.list[k];
    owners |= 1 << b.owner;
    burstTicks.set(b.id, tb);
    const passed = b.path.slice(0, sim.loc[k]);
    burstOne(sim, k, tb, painted, washed, queue);
    // It could have been stopped early on any tile it slid across: paint those crosses too.
    for (const from of passed) paintCross(sim, from, b.range, tb, (tile) => sweepPaint(sim, tile, tb, b.owner));
  }
  const until = tb + CONFIG.SPLASH_TICKS;
  for (const tile of painted) pushWet(sim.wet, tile, tb, until, owners, WetKind.Cascade);
  soakSliders(sim, painted, tb);
}

/** Paints one balloon's cross, queueing every unburst balloon its arms reach. */
function burstOne(sim: SimScratch, k: number, tb: number, painted: Set<number>, washed: number[], queue: number[]): void {
  const b = sim.list[k];
  const center = tileOfBalloon(sim, k);
  removeBalloon(sim, k);
  paintCross(sim, center, b.range, tb, (tile) => {
    painted.add(tile);
    if (sim.tiles[tile] === Tile.Castle && sim.input.floodTick[tile] >= tb) washed.push(tile);
    const other = sim.at[tile];
    if (other >= 0 && sim.status[other] === PENDING) {
      sim.status[other] = QUEUED;
      queue.push(other);
    }
  });
}

/** Non-chaining danger from a kicked balloon's possible early stop along its slide. */
function sweepPaint(sim: SimScratch, tile: number, tb: number, owner: number): void {
  pushWet(sim.wet, tile, tb, tb + CONFIG.SPLASH_TICKS, 1 << owner, WetKind.SlideSweep);
}

/**
 * Walks the four arms from `center` exactly like the sim: stop before out-of-bounds or a boulder,
 * include then stop at a castle (unless the tide dissolved it earlier) or an unburst balloon.
 */
function paintCross(sim: SimScratch, center: number, range: number, tb: number, visit: (tile: number) => void): void {
  const { w, h, floodTick } = sim.input;
  const cx = center % w;
  const cy = (center - cx) / w;
  visit(center);
  for (const dir of ALL_DIRS) {
    for (let step = 1; step <= range; step++) {
      const x = cx + DIR_DX[dir] * step;
      const y = cy + DIR_DY[dir] * step;
      if (!inBounds(w, h, x, y)) break;
      const tile = idx(w, x, y);
      const kind = sim.tiles[tile];
      if (kind === Tile.Boulder) break;
      visit(tile);
      const castle = kind === Tile.Castle && floodTick[tile] >= tb;
      const balloon = sim.at[tile] >= 0;
      if (castle || balloon) break;
    }
  }
}
