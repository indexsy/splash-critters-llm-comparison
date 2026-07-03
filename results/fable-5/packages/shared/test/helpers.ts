import type { GeneratedMap } from "../src/map.js";
import { createSimState } from "../src/sim.js";
import { TILE, type SimBalloon, type SimState } from "../src/types.js";
import { CONFIG, type PowerupType } from "../src/config.js";

/** Bordered arena with NO pillars/castles — a controlled splash sandbox. */
export function blankMap(w = 9, h = 9): GeneratedMap {
  const grid = new Array(w * h).fill(TILE.EMPTY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) grid[y * w + x] = TILE.BOULDER;
    }
  }
  return {
    w,
    h,
    grid,
    contents: new Array(w * h).fill(null),
    spawns: [
      { x: 1, y: 1 },
      { x: w - 2, y: h - 2 },
      { x: w - 2, y: 1 },
      { x: 1, y: h - 2 },
    ],
  };
}

export function makeState(players = 2, w = 9, h = 9): SimState {
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  return createSimState("duel", blankMap(w, h), ids, { enableKick: true, revengeDucks: false });
}

export function setCastle(state: SimState, x: number, y: number, contents: PowerupType | null = null): void {
  state.grid[y * state.w + x] = TILE.CASTLE;
  state.contents[y * state.w + x] = contents;
}

export function setBoulder(state: SimState, x: number, y: number): void {
  state.grid[y * state.w + x] = TILE.BOULDER;
}

export function placeBalloon(
  state: SimState,
  slot: number,
  x: number,
  y: number,
  range: number,
  fuseTicks = CONFIG.FUSE_TICKS
): SimBalloon {
  const b: SimBalloon = {
    id: state.nextBalloonId++,
    ownerSlot: slot,
    x,
    y,
    burstTick: state.tick + fuseTicks,
    range,
    placedTick: state.tick,
    ownerCanPass: false,
    slide: null,
    revenge: false,
  };
  state.balloons.push(b);
  if (slot >= 0) state.players[slot].balloonsActive++;
  return b;
}

/** Park all players in a far corner so splash tests don't soak them. */
export function parkPlayers(state: SimState): void {
  for (const p of state.players) {
    p.x = state.w - 1.5;
    p.y = state.h - 1.5;
  }
}

export function noInputs(state: SimState): null[] {
  return new Array(state.players.length).fill(null);
}
