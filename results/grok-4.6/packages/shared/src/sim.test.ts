import { describe, expect, it } from "vitest";
import { CONFIG } from "./config.js";
import { generateMap } from "./map.js";
import { SeededRng, mulberry32 } from "./rng.js";
import {
  cloneRound,
  createRound,
  defaultPlayer,
  simulateTick,
} from "./sim.js";
import type { PlayerInput, RoundState } from "./types.js";
import { tileIndex } from "./types.js";

function emptyInput(id: string, tick: number, extra: Partial<PlayerInput> = {}): [string, PlayerInput] {
  return [id, { seq: tick, tick, dir: "none", balloonPressed: false, ...extra }];
}

function runTicks(state: RoundState, n: number, inputs: Map<string, PlayerInput> = new Map()): RoundState {
  for (let i = 0; i < n; i++) simulateTick(state, inputs);
  return state;
}

describe("rng determinism", () => {
  it("mulberry32 is deterministic", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("SeededRng same seed same sequence", () => {
    const a = new SeededRng(99);
    const b = new SeededRng(99);
    expect(Array.from({ length: 10 }, () => a.float())).toEqual(
      Array.from({ length: 10 }, () => b.float()),
    );
  });
});

describe("map generation", () => {
  it("identical seed produces identical map and hidden powerups", () => {
    const a = generateMap(12345, 13, 11, "backyard", 2);
    const b = generateMap(12345, 13, 11, "backyard", 2);
    expect(a.arena.tiles).toEqual(b.arena.tiles);
    expect(a.hidden).toEqual(b.hidden);
    expect(a.spawns).toEqual(b.spawns);
  });

  it("different seeds produce different hidden contents or tiles", () => {
    const a = generateMap(1, 15, 13, "beach", 4);
    const b = generateMap(2, 15, 13, "beach", 4);
    const sameTiles = a.arena.tiles.every((t, i) => t === b.arena.tiles[i]);
    const sameHidden = JSON.stringify(a.hidden) === JSON.stringify(b.hidden);
    expect(sameTiles && sameHidden).toBe(false);
  });

  it("borders and even-even pillars are boulders", () => {
    const m = generateMap(7, 13, 11, "pool", 2);
    expect(m.arena.tiles[tileIndex(0, 0, 13)]).toBe("boulder");
    expect(m.arena.tiles[tileIndex(2, 2, 13)]).toBe("boulder");
    expect(m.arena.tiles[tileIndex(1, 1, 13)]).not.toBe("boulder");
  });
});

describe("splash propagation", () => {
  it("splash stops at the first sandcastle", () => {
    const state = createRound(1, 13, 11, "backyard", [
      defaultPlayer("p1", 0, "A"),
      defaultPlayer("p2", 1, "B"),
    ]);
    const w = state.arena.width;
    for (let i = 0; i < state.arena.tiles.length; i++) {
      if (state.arena.tiles[i] === "castle") state.arena.tiles[i] = "empty";
    }
    state.players[0]!.x = 3;
    state.players[0]!.y = 3;
    state.players[0]!.splashRange = 5;
    state.arena.tiles[tileIndex(5, 3, w)] = "castle";
    state.arena.tiles[tileIndex(6, 3, w)] = "castle";

    const inputs = new Map<string, PlayerInput>([emptyInput("p1", 0, { balloonPressed: true })]);
    simulateTick(state, inputs);
    runTicks(state, CONFIG.FUSE_TICKS + 2);

    expect(state.arena.tiles[tileIndex(5, 3, w)]).toBe("empty");
    expect(state.arena.tiles[tileIndex(6, 3, w)]).toBe("castle");
    const splashAt6 = state.splashes.some((s) => s.tx === 6 && s.ty === 3);
    expect(splashAt6).toBe(false);
  });

  it("3-balloon chain bursts in one tick", () => {
    const state = createRound(1, 13, 11, "backyard", [
      defaultPlayer("p1", 0, "A", { balloonCount: 8, splashRange: 3 }),
      defaultPlayer("p2", 1, "B"),
    ]);
    for (let i = 0; i < state.arena.tiles.length; i++) {
      if (state.arena.tiles[i] === "castle") state.arena.tiles[i] = "empty";
    }
    state.players[0]!.x = 1;
    state.players[0]!.y = 1;
    state.balloons.push(
      { id: 1, ownerId: "p1", tx: 3, ty: 1, fuseLeft: 1, range: 3, sliding: false, slideDir: "none" },
      { id: 2, ownerId: "p1", tx: 5, ty: 1, fuseLeft: 80, range: 3, sliding: false, slideDir: "none" },
      { id: 3, ownerId: "p1", tx: 7, ty: 1, fuseLeft: 80, range: 3, sliding: false, slideDir: "none" },
    );
    state.players[0]!.balloonsOut = 3;
    simulateTick(state, new Map());
    expect(state.balloons.length).toBe(0);
    const chain = state.events.find((e) => e.type === "chain_burst");
    expect(chain).toBeTruthy();
    expect((chain as { count: number }).count).toBeGreaterThanOrEqual(3);
  });
});

describe("simulateTick determinism", () => {
  it("same inputs produce identical state", () => {
    const mk = () =>
      createRound(999, 13, 11, "backyard", [
        defaultPlayer("p1", 0, "A"),
        defaultPlayer("p2", 1, "B"),
      ]);
    const a = mk();
    const b = mk();
    const inputs = new Map<string, PlayerInput>([
      emptyInput("p1", 0, { dir: "right" }),
      emptyInput("p2", 0, { dir: "left" }),
    ]);
    for (let i = 0; i < 40; i++) {
      simulateTick(a, inputs);
      simulateTick(b, inputs);
    }
    expect(a.players[0]!.x).toBe(b.players[0]!.x);
    expect(a.players[1]!.y).toBe(b.players[1]!.y);
    expect(a.arena.tiles).toEqual(b.arena.tiles);
  });

  it("cloneRound isolates mutations", () => {
    const a = createRound(3, 13, 11, "beach", [defaultPlayer("p1", 0, "A")]);
    const b = cloneRound(a);
    a.players[0]!.x = 9;
    expect(b.players[0]!.x).not.toBe(9);
  });
});
