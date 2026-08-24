import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { defaultMatchConfig, generateMap } from "../src/map";
import { Rng } from "../src/rng";
import {
  createSimState,
  simulateTick,
} from "../src/sim";
import { TILE_CASTLE, TILE_FLOOR } from "../src/map";
import type { MatchConfig, SimPlayerInput } from "../src/types";

function cfg(mode: "duel" | "ffa", seed = 12345): MatchConfig {
  return defaultMatchConfig(mode, { mapSeed: seed, theme: "beach" });
}

const NO_INPUT = {};

function input(dirX = 0, dirY = 0, balloon = false): SimPlayerInput {
  return { seq: 0, tick: 0, dirX, dirY, balloonPressed: balloon };
}

describe("map generation determinism", () => {
  it("identical seed → identical grid + hidden contents", () => {
    const a = generateMap(cfg("ffa"));
    const b = generateMap(cfg("ffa"));
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid));
    expect(a.hidden).toEqual(b.hidden);
    expect(a.spawns).toEqual(b.spawns);
  });

  it("different seeds differ", () => {
    const a = generateMap(cfg("ffa", 1));
    const b = generateMap(cfg("ffa", 2));
    const aHidden = a.hidden.map((h) => `${h.tile}:${h.type}`).join(",");
    const bHidden = b.hidden.map((h) => `${h.tile}:${h.type}`).join(",");
    expect(aHidden).not.toBe(bHidden);
  });

  it("spawn areas are clear of castles", () => {
    const m = generateMap(cfg("ffa"));
    for (const s of m.spawns) {
      for (let i = -2; i <= 2; i++) {
        const tx = s.x + i;
        const ty = s.y + i;
        if (tx >= 1 && tx <= m.w - 2) expect(m.grid[s.y * m.w + tx]).not.toBe(TILE_CASTLE);
        if (ty >= 1 && ty <= m.h - 2) expect(m.grid[ty * m.w + s.x]).not.toBe(TILE_CASTLE);
      }
    }
  });

  it("rng deterministic across instances", () => {
    const r1 = new Rng(42);
    const r2 = new Rng(42);
    for (let i = 0; i < 100; i++) expect(r1.next()).toBe(r2.next());
  });
});

function findCastleAdjacentFloor(grid: Uint8Array, w: number, h: number): { x: number; y: number; cx: number; cy: number } | null {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y * w + x] !== TILE_FLOOR) continue;
      if (grid[y * w + x + 1] === TILE_CASTLE) return { x, y, cx: x + 1, cy: y };
      if (grid[y * w + x - 1] === TILE_CASTLE) return { x, y, cx: x - 1, cy: y };
      if ((y + 1 < h - 1) && grid[(y + 1) * w + x] === TILE_CASTLE) return { x, y, cx: x, cy: y + 1 };
      if ((y - 1 > 0) && grid[(y - 1) * w + x] === TILE_CASTLE) return { x, y, cx: x, cy: y - 1 };
    }
  }
  return null;
}

describe("splash propagation", () => {
  it("splash stops at the first sandcastle per direction and washes it", () => {
    const state = createSimState(cfg("duel"), ["p1", "p2"]);
    const spot = findCastleAdjacentFloor(state.grid, state.config.w, state.config.h)!;
    const p = state.players[0]!;
    const p2 = state.players[1]!;
    p.x = spot.x;
    p.y = spot.y;
    p.splashRange = 5;
    // keep p2 safe in a far corner
    p2.x = state.config.w - 2.5;
    p2.y = state.config.h - 2.5;
    simulateTick(state, { p1: input(0, 0, true) });
    simulateTick(state, NO_INPUT); // release → drop happens on press edge
    const bal = state.balloons[0];
    expect(bal).toBeTruthy();
    const { w } = state.config;
    const castleTile = spot.cy * w + spot.cx;

    // Move player far from the blast before it pops
    for (let t = 0; t < CONFIG.fuseTicks - 20 && !state.roundOver; t++) {
      simulateTick(state, {
        p1: input(spot.x > w / 2 ? -1 : 1, 0),
        p2: input(0, 0),
      });
    }
    let washed = false;
    for (let t = 0; t < CONFIG.fuseTicks + CONFIG.splashLingerTicks + 10; t++) {
      if (state.roundOver) break;
      const evs = simulateTick(state, NO_INPUT);
      if (evs.some((e) => e.type === "castle_washed" && e.tile === castleTile)) washed = true;
    }
    expect(washed).toBe(true);
  });

  it("chain resolves fully within a single server tick", () => {
    const state = createSimState(cfg("duel", 999), ["p1", "p2"]);
    const { w, h } = state.config;
    state.grid.fill(TILE_FLOOR);
    for (let x = 0; x < w; x++) {
      state.grid[x] = 1;
      state.grid[(h - 1) * w + x] = 1;
    }
    for (let y = 0; y < h; y++) {
      state.grid[y * w] = 1;
      state.grid[y * w + w - 1] = 1;
    }
    const [a, b] = state.players;
    a!.x = 3;
    a!.y = 6;
    b!.x = w - 2.5;
    b!.y = h - 2.5;
    a!.alive = true;
    b!.alive = true;
    const mk = (id: number, x: number, fuse: number) => ({
      id,
      owner: "p1",
      x,
      y: 3,
      fuse,
      range: 6,
      sliding: false,
      slideDirX: 0,
      slideDirY: 0,
      slideProgress: 0,
      chainDepth: 0,
    });
    state.balloons.push(mk(1, 4, 10), mk(2, 5, 90), mk(3, 6, 90));
    // tick 9 times: nothing bursts yet
    for (let t = 0; t < 9; t++) simulateTick(state, NO_INPUT);
    expect(state.balloons.length).toBe(3);
    // tick 10: balloon 1 explodes, chains 2 and 3 — all in this single tick
    simulateTick(state, NO_INPUT);
    expect(state.balloons.length).toBe(0);
  });
});
