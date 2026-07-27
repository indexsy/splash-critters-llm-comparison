/**
 * Where a bot must not be standing, and when.
 *
 * Rebuilt from the live GameState every tick. Every live balloon is expanded
 * into the splash it is about to make, using exactly the rules detonate() uses,
 * and chains are propagated so a balloon sitting inside another balloon's
 * footprint inherits the earlier burst. Water - present or scheduled - is
 * permanent danger, because the tide never recedes.
 */

import {
  CARDINALS,
  CONFIG,
  DIR_VECTORS,
  Tile,
  balloonAtTile,
  idx,
  tileAt,
} from '@splash/shared';
import type { GameState } from '@splash/shared';

export interface DangerMap {
  width: number;
  height: number;
  /** Absolute tick a tile is first splashed. Infinity when it is safe. */
  burstTick: Float64Array;
  /** Absolute tick the splash on that tile clears. */
  clearTick: Float64Array;
  /** True when standing there at that tick would be lethal (includes tide). */
  isDangerous(tx: number, ty: number, atTick: number): boolean;
}

/** One balloon (real or hypothetical) about to become a splash. */
export interface SplashSource {
  x: number;
  y: number;
  range: number;
  /** Absolute tick it bursts. */
  tick: number;
}

/** Chains settle in one or two passes; the cap keeps a pathological map cheap. */
const MAX_CHAIN_PASSES = 4;

type TileVisitor = (tx: number, ty: number) => void;

/**
 * Walk the cross a balloon at (bx, by) would wet. Mirrors detonate(): arms die
 * on boulders and water, wash exactly one sandcastle, and stop on the first
 * balloon they touch (that balloon is still covered, and chains from there).
 */
function forEachSplashTile(
  state: GameState,
  src: SplashSource,
  hasBalloon: (tx: number, ty: number) => boolean,
  visit: TileVisitor,
): void {
  visit(src.x, src.y);
  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    for (let step = 1; step <= src.range; step++) {
      const tx = src.x + dx * step;
      const ty = src.y + dy * step;
      const tile = tileAt(state, tx, ty);
      if (tile === Tile.BOULDER || tile === Tile.WATER) break;
      if (tile === Tile.CASTLE) {
        visit(tx, ty);
        break;
      }
      visit(tx, ty);
      if (hasBalloon(tx, ty)) break;
    }
  }
}

/** Pull every burst forward to the earliest balloon that reaches it. */
function settleChains(
  state: GameState,
  sources: SplashSource[],
  hasBalloon: (tx: number, ty: number) => boolean,
): void {
  for (let pass = 0; pass < MAX_CHAIN_PASSES; pass++) {
    let changed = false;
    for (const src of sources) {
      forEachSplashTile(state, src, hasBalloon, (tx, ty) => {
        for (const other of sources) {
          if (other === src || other.x !== tx || other.y !== ty) continue;
          if (other.tick > src.tick) {
            other.tick = src.tick;
            changed = true;
          }
        }
      });
    }
    if (!changed) return;
  }
}

/**
 * Danger as it will be if `extra` is also placed. Passing null gives the plain
 * reading of the world, which is what computeDangerMap returns.
 */
export function computeDangerMapWith(state: GameState, extra: SplashSource | null): DangerMap {
  const { width, height } = state;
  const size = width * height;
  const burstTick = new Float64Array(size).fill(Infinity);
  const clearTick = new Float64Array(size).fill(-Infinity);
  // Kept private: splash windows open and shut, water never does, and folding
  // the two into one interval would make every threatened tile look doomed
  // forever - which is how a bot talks itself into standing still and drowning.
  const floodTick = new Float64Array(size).fill(Infinity);

  const mark = (i: number, burst: number, clear: number): void => {
    if (burst < burstTick[i]) burstTick[i] = burst;
    if (clear > clearTick[i]) clearTick[i] = clear;
  };

  // Water already here, and water on its way, is danger with no end.
  for (let i = 0; i < size; i++) {
    if (state.cells[i] === Tile.WATER) floodTick[i] = -Infinity;
  }
  for (let k = state.tideCursor; k < state.tideOrder.length; k++) {
    const i = state.tideOrder[k];
    if (state.tideTicks[k] < floodTick[i]) floodTick[i] = state.tideTicks[k];
  }

  // Splashes already on the ground stay lethal until they dry.
  for (const splash of state.splashes) {
    mark(idx(width, splash.x, splash.y), state.tick, splash.endTick + 1);
    for (const dir of CARDINALS) {
      const [dx, dy] = DIR_VECTORS[dir];
      for (let step = 1; step <= splash.arms[dir]; step++) {
        mark(idx(width, splash.x + dx * step, splash.y + dy * step), state.tick, splash.endTick + 1);
      }
    }
  }

  const hasBalloon = (tx: number, ty: number): boolean =>
    balloonAtTile(state, tx, ty) !== undefined ||
    (extra !== null && extra.x === tx && extra.y === ty);

  const sources: SplashSource[] = state.balloons.map((balloon) => ({
    // Sliding balloons still burst on whatever tile they are crossing.
    x: Math.floor(balloon.x),
    y: Math.floor(balloon.y),
    range: balloon.range,
    tick: balloon.burstTick,
  }));
  if (extra) sources.push({ ...extra });

  settleChains(state, sources, hasBalloon);
  for (const src of sources) {
    forEachSplashTile(state, src, hasBalloon, (tx, ty) => {
      mark(idx(width, tx, ty), src.tick, src.tick + CONFIG.SPLASH_TICKS + 1);
    });
  }

  // The published pair says when a tile first turns lethal and when that lets
  // up, so the tide folds in whenever it is the earlier or the lasting threat.
  for (let i = 0; i < size; i++) {
    if (floodTick[i] < burstTick[i]) {
      burstTick[i] = floodTick[i];
      clearTick[i] = Infinity;
    } else if (floodTick[i] < clearTick[i]) {
      clearTick[i] = Infinity;
    }
  }

  return {
    width,
    height,
    burstTick,
    clearTick,
    isDangerous(tx: number, ty: number, atTick: number): boolean {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
      const i = idx(width, tx, ty);
      if (atTick >= floodTick[i]) return true;
      return atTick >= burstTick[i] && atTick < clearTick[i];
    },
  };
}

export function computeDangerMap(state: GameState): DangerMap {
  return computeDangerMapWith(state, null);
}

/** The view of an easy bot having one of its bad moments: nothing looks lethal. */
export function blindDangerMap(base: DangerMap): DangerMap {
  return {
    width: base.width,
    height: base.height,
    burstTick: base.burstTick,
    clearTick: base.clearTick,
    isDangerous: () => false,
  };
}
