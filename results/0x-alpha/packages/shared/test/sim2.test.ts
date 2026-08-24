import { describe, expect, it } from "vitest";
import { createSimState, simulateTick } from "../src/sim";
import { defaultMatchConfig } from "../src/map";
import { CONFIG } from "../src/config";
import type { MatchConfig, SimPlayerInput } from "../src/types";

function cfg(seed = 555): MatchConfig {
  return defaultMatchConfig("duel", { mapSeed: seed, theme: "beach" });
}

function input(dirX = 0, dirY = 0, balloon = false): SimPlayerInput {
  return { seq: 0, tick: 0, dirX, dirY, balloonPressed: balloon };
}

/** Empty arena with border boulders only. */
function emptyArena(state: ReturnType<typeof createSimState>): void {
  const { w, h } = state.config;
  state.grid.fill(0);
  for (let x = 0; x < w; x++) {
    state.grid[x] = 1;
    state.grid[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    state.grid[y * w] = 1;
    state.grid[y * w + w - 1] = 1;
  }
}

describe("movement & validation", () => {
  it("player cannot walk through boulders or borders", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    // interior pillar at (4,4) — even/even
    state.grid[4 * state.config.w + 4] = 1;
    const p = state.players[0]!;
    p.x = 3;
    p.y = 4;
    for (let i = 0; i < 120; i++) simulateTick(state, { p1: input(1, 0), p2: input() });
    expect(p.x).toBeLessThan(4.15);
    expect(Math.round(p.y)).toBe(4);
    // border wall
    for (let i = 0; i < 200; i++) simulateTick(state, { p1: input(-1, 0), p2: input() });
    expect(p.x).toBeGreaterThanOrEqual(0.55);
    expect(Math.round(p.x)).toBeGreaterThanOrEqual(1);
  });

  it("stats only exceed caps never — powerup application caps correctly", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const p = state.players[0]!;
    p.balloonCount = CONFIG.balloonCountCap;
    p.splashRange = CONFIG.splashRangeCap;
    p.speed = CONFIG.speedCap;
    state.exposed.push({ id: 998, x: Math.round(p.x), y: Math.round(p.y), type: "balloon" });
    simulateTick(state, {});
    expect(p.balloonCount).toBe(CONFIG.balloonCountCap);
    state.exposed.push({ id: 999, x: Math.round(p.x), y: Math.round(p.y), type: "range" });
    simulateTick(state, {});
    expect(p.splashRange).toBe(CONFIG.splashRangeCap);
  });

  it("cannot drop two balloons on one tile and respects max simultaneous", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const p = state.players[0]!;
    p.balloonCount = 2;
    p.x = 3;
    p.y = 3;
    simulateTick(state, { p1: input(0, 0, true), p2: input() });
    expect(state.balloons.length).toBe(1);
    simulateTick(state, { p1: input(0, 0, true), p2: input() });
    expect(state.balloons.length).toBe(1);
    // move off, drop again — allowed
    for (let i = 0; i < 20; i++) simulateTick(state, { p1: input(1, 0), p2: input() });
    simulateTick(state, { p1: input(0, 0, true), p2: input() });
    expect(state.balloons.length).toBe(2);
    // third exceeds count of 2
    for (let i = 0; i < 20; i++) simulateTick(state, { p1: input(1, 0), p2: input() });
    simulateTick(state, { p1: input(0, 0, true), p2: input() });
    expect(state.balloons.length).toBe(2);
  });

  it("base balloon count of 1 blocks a second balloon", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const p = state.players[0]!;
    p.x = 3;
    p.y = 3;
    simulateTick(state, { p1: input(0, 0, true), p2: input() });
    for (let i = 0; i < 30; i++) simulateTick(state, { p1: input(1, 0), p2: input() });
    simulateTick(state, { p1: input(0, 0, true), p2: input() });
    expect(state.balloons.filter((b) => !b.sliding).length).toBe(1);
  });

  it("server ignores NaN/garbage inputs without corrupting state", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const p = state.players[0]!;
    const bad = { seq: -5, tick: 999999, dirX: Number.NaN, dirY: 1e9, balloonPressed: true };
    for (let i = 0; i < 10; i++) simulateTick(state, { p1: bad as unknown as SimPlayerInput, p2: input() });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("powerups & kick", () => {
  it("boots allow kicking a balloon which slides and stops before a wall", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const { w } = state.config;
    const p = state.players[0]!;
    p.x = 4;
    p.y = 4;
    p.hasBoots = true;
    state.balloons.push({
      id: 50,
      owner: "p2",
      x: 5,
      y: 4,
      fuse: 600,
      range: 2,
      sliding: false,
      slideDirX: 0,
      slideDirY: 0,
      slideProgress: 0,
      chainDepth: 0,
    });
    let kicked = false;
    for (let t = 0; t < 60 && !kicked; t++) {
      const evs = simulateTick(state, { p1: input(1, 0), p2: input() });
      if (evs.some((e) => e.type === "balloon_kicked")) kicked = true;
    }
    expect(kicked).toBe(true);
    // let it finish sliding right until wall
    for (let t = 0; t < 120 && state.balloons[0]?.sliding; t++) simulateTick(state, {});
    expect(state.balloons[0]!.sliding).toBe(false);
    expect(state.balloons[0]!.x).toBe(w - 2);
  });
});

describe("soaks & round end", () => {
  it("splash soaks player standing in it; owner survives if clear", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const [a, b] = state.players;
    a!.x = 4;
    a!.y = 8;
    b!.x = 6;
    b!.y = 4;
    state.balloons.push({
      id: 7,
      owner: "p1",
      x: 4,
      y: 4,
      fuse: 2,
      range: 3,
      sliding: false,
      slideDirX: 0,
      slideDirY: 0,
      slideProgress: 0,
      chainDepth: 0,
    });
    let soaked = false;
    for (let t = 0; t < 10 && !soaked; t++) {
      const evs = simulateTick(state, {});
      if (evs.some((e) => e.type === "player_soaked" && e.target === "p2")) soaked = true;
    }
    expect(soaked).toBe(true);
    expect(b!.alive).toBe(false);
    expect(a!.alive).toBe(true);
    expect(state.roundOver).toBe(true);
    expect(state.winnerIds).toEqual(["p1"]);
  });

  it("last two soaked same tick = draw round", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    emptyArena(state);
    const [a, b] = state.players;
    a!.x = 6;
    a!.y = 4;
    b!.x = 4;
    b!.y = 6;
    state.balloons.push({
      id: 7,
      owner: "p1",
      x: 4,
      y: 4,
      fuse: 2,
      range: 3,
      sliding: false,
      slideDirX: 0,
      slideDirY: 0,
      slideProgress: 0,
      chainDepth: 0,
    });
    for (let t = 0; t < 10; t++) simulateTick(state, {});
    expect(a!.alive).toBe(false);
    expect(b!.alive).toBe(false);
    expect(state.roundOver).toBe(true);
    expect(state.winnerIds).toEqual([]);
  });

  it("rising tide floods rings inward over time", () => {
    const state = createSimState(cfg(), ["p1", "p2"]);
    const { w } = state.config;
    let guard = 0;
    while (!state.roundOver && guard++ < CONFIG.tideStartSec * CONFIG.tickRate) {
      simulateTick(state, {});
      if (state.tick === 60) {
        state.players[0]!.x = 6;
        state.players[0]!.y = 5;
        state.players[1]!.x = 7;
        state.players[1]!.y = 6;
      }
    }
    expect(state.roundOver).toBe(false);
    for (let i = 0; i < CONFIG.tideRingIntervalTicks * 3; i++) simulateTick(state, {});
    expect(state.tideRing).toBeGreaterThanOrEqual(2);
    expect(state.grid[1 * w + 1]).toBe(3); // corner flooded
  });
});

describe("determinism of full rounds", () => {
  it("same seed + same inputs → identical outcome", () => {
    const run = () => {
      const state = createSimState({ ...cfg(4242), enableRevengeDucks: false }, ["p1", "p2"]);
      let frames = 0;
      while (!state.roundOver && frames < 60 * CONFIG.tickRate) {
        const d = frames % 90 < 45 ? input(1, 0, frames % 180 === 30) : input(0, 1, frames % 150 === 30);
        simulateTick(state, { p1: d, p2: d });
        frames++;
      }
      return {
        winner: [...state.winnerIds],
        tick: state.tick,
        gridHash: Array.from(state.grid).join(""),
        soaks: state.players.map((p) => `${p.id}:${p.soaks}:${p.castlesWashed}`).join("|"),
      };
    };
    expect(run()).toEqual(run());
  });
});
