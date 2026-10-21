import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { generateArena } from "../src/map.js";
import { mulberry32 } from "../src/rng.js";
import {
  addBalloonForTest,
  createRoundState,
  simulateTick,
} from "../src/sim.js";
import type { Arena, PlayerInput, RoundState } from "../src/types.js";

function testArena(w = 10, h = 10): Arena {
  const boulders = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => x === 0 || y === 0 || x === w - 1 || y === h - 1),
  );
  const castles = Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
  const hidden = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => null as never),
  );
  return {
    w,
    h,
    theme: "beach",
    seed: 1,
    boulders,
    castles,
    hidden,
    spawnTiles: [
      { x: 1, y: 1 },
      { x: 8, y: 8 },
      { x: 8, y: 1 },
      { x: 1, y: 8 },
    ],
  };
}

function makeState(arena = testArena()): RoundState {
  return createRoundState(
    "duel",
    arena,
    [
      { id: "a", slot: 0, name: "A", animal: "frog", hat: "none", isBot: false },
      { id: "b", slot: 1, name: "B", animal: "duck", hat: "none", isBot: false },
    ],
  );
}

function idle(): Record<string, PlayerInput> {
  return {};
}

describe("mulberry32", () => {
  it("is deterministic", () => {
    const one = mulberry32(1234);
    const two = mulberry32(1234);
    const first = Array.from({ length: 20 }, () => one.next());
    const second = Array.from({ length: 20 }, () => two.next());
    expect(first).toEqual(second);
  });
});

describe("map generation", () => {
  it("produces identical maps and hidden powerups for the same seed", () => {
    const one = generateArena("ffa", 987654, "pool");
    const two = generateArena("ffa", 987654, "pool");
    expect(one.castles).toEqual(two.castles);
    expect(one.boulders).toEqual(two.boulders);
    expect(one.hidden).toEqual(two.hidden);
    expect(one.spawnTiles).toEqual(two.spawnTiles);
    const hiddenCount = one.hidden.flat().filter((entry) => entry !== null).length;
    expect(hiddenCount).toBeGreaterThan(0);
    expect(hiddenCount).toBeLessThan(
      one.castles.flat().filter((entry) => entry === 1).length,
    );
  });

  it("keeps every spawn tile and its two-step cross clear", () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const arena = generateArena("ffa", seed, "backyard");
      for (const spawn of arena.spawnTiles) {
        expect(arena.boulders[spawn.y]?.[spawn.x]).toBe(false);
        expect(arena.castles[spawn.y]?.[spawn.x]).toBe(0);
        for (let step = 1; step <= 2; step += 1) {
          for (const [dx, dy] of [
            [step, 0],
            [-step, 0],
            [0, step],
            [0, -step],
          ]) {
            const x = spawn.x + dx;
            const y = spawn.y + dy;
            if (x <= 0 || y <= 0 || x >= arena.w - 1 || y >= arena.h - 1) continue;
            if (arena.boulders[y]?.[x]) continue;
            expect(arena.castles[y]?.[x]).toBe(0);
          }
        }
      }
    }
  });
});

describe("splash simulation", () => {
  it("bursts a three-balloon chain within one tick", () => {
    const state = makeState();
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 1.5;
    state.players[1]!.y = 8.5;
    addBalloonForTest(state, "a", 2, 2, 1, 1);
    addBalloonForTest(state, "b", 3, 2, 1, 100);
    addBalloonForTest(state, "a", 4, 2, 1, 100);
    const events = simulateTick(state, idle());
    expect(state.balloons).toHaveLength(0);
    expect(state.splashes.length).toBeGreaterThan(0);
    const chain = events.find((event) => event.type === "chain_burst");
    expect(chain).toMatchObject({ type: "chain_burst", count: 3 });
    expect(state.players.every((player) => player.alive)).toBe(true);
  });

  it("stops a splash at the first sandcastle", () => {
    const arena = testArena();
    arena.castles[3]![2] = 1;
    arena.castles[5]![2] = 1;
    const state = makeState(arena);
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 1.5;
    state.players[1]!.y = 8.5;
    addBalloonForTest(state, "a", 2, 2, 5, 1);
    const events = simulateTick(state, idle());
    expect(arena.castles[3]?.[2]).toBe(0);
    expect(arena.castles[5]?.[2]).toBe(1);
    expect(state.splashes.some((splash) => splash.x === 2 && splash.y === 4)).toBe(false);
    expect(
      events.some((event) => event.type === "castle_washed" && event.x === 2 && event.y === 3),
    ).toBe(true);
  });

  it("rejects a splash at the boundary of a boulder", () => {
    const arena = testArena();
    arena.boulders[4]![2] = true;
    const state = makeState(arena);
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 1.5;
    state.players[1]!.y = 8.5;
    addBalloonForTest(state, "a", 2, 2, 3, 1);
    simulateTick(state, idle());
    expect(state.splashes.some((splash) => splash.x === 2 && splash.y === 4)).toBe(false);
    expect(state.splashes.some((splash) => splash.x === 2 && splash.y === 3)).toBe(true);
  });

  it("soaks players caught in a splash", () => {
    const state = makeState();
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 2.5;
    state.players[1]!.y = 3.5;
    addBalloonForTest(state, "a", 2, 2, 2, 1);
    const events = simulateTick(state, idle());
    expect(state.players[1]?.alive).toBe(false);
    expect(state.ended).toBe(true);
    expect(events.some((event) => event.type === "player_soaked")).toBe(true);
    expect(state.winnerId).toBe("a");
  });

  it("resolves a simultaneous double soak as a draw", () => {
    const state = makeState();
    state.players[0]!.x = 3.5;
    state.players[0]!.y = 3.5;
    state.players[1]!.x = 7.5;
    state.players[1]!.y = 3.5;
    addBalloonForTest(state, "a", 2, 3, 1, 1);
    addBalloonForTest(state, "b", 8, 3, 1, 1);
    simulateTick(state, idle());
    expect(state.players.every((player) => !player.alive)).toBe(true);
    expect(state.ended).toBe(true);
    expect(state.draw).toBe(true);
    expect(state.winnerId).toBeNull();
  });

  it("reveals hidden powerups only when their castle is washed", () => {
    const arena = testArena();
    arena.castles[2]![4] = 1;
    arena.hidden[2]![4] = "splash";
    arena.castles[2]![6] = 1;
    arena.hidden[2]![6] = "balloon";
    const state = makeState(arena);
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 1.5;
    state.players[1]!.y = 8.5;
    addBalloonForTest(state, "a", 2, 2, 3, 1);
    const events = simulateTick(state, idle());
    expect(arena.castles[2]?.[4]).toBe(0);
    expect(arena.castles[2]?.[6]).toBe(1);
    const revealed = events.filter((event) => event.type === "powerup_revealed");
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toMatchObject({ type: "powerup_revealed", powerup: { kind: "splash" } });
    expect(state.powerups).toHaveLength(1);
  });

  it("uses a balloon's own range when chaining", () => {
    const state = makeState();
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 1.5;
    state.players[1]!.y = 8.5;
    addBalloonForTest(state, "a", 2, 2, 1, 1);
    addBalloonForTest(state, "b", 3, 2, 3, 100);
    simulateTick(state, idle());
    expect(state.splashes.some((splash) => splash.x === 6 && splash.y === 2)).toBe(true);
  });

  it("keeps fuses deterministic across repeated simulations", () => {
    const first = makeState();
    const second = makeState();
    for (const state of [first, second]) {
      state.players[0]!.x = 5.5;
      state.players[0]!.y = 5.5;
      state.players[1]!.x = 1.5;
      state.players[1]!.y = 8.5;
      addBalloonForTest(state, "a", 3, 3, 2, CONFIG.FUSE_TICKS);
    }
    const inputs: Record<string, PlayerInput> = {
      a: { seq: 1, tick: 1, dir: "up", balloonPressed: false },
      b: { seq: 1, tick: 1, dir: "left", balloonPressed: false },
    };
    for (let tick = 0; tick < 120; tick += 1) {
      simulateTick(first, inputs);
      simulateTick(second, inputs);
    }
    expect(first.players.map((player) => [player.x, player.y])).toEqual(
      second.players.map((player) => [player.x, player.y]),
    );
    expect(first.balloons).toEqual(second.balloons);
    expect(first.splashes).toEqual(second.splashes);
  });

  it("starts the rising tide after two minutes and floods inward", () => {
    const state = makeState();
    state.tick = CONFIG.TIDE_START_TICKS - 1;
    state.players[0]!.x = 8.5;
    state.players[0]!.y = 1.5;
    state.players[1]!.x = 8.5;
    state.players[1]!.y = 8.5;
    simulateTick(state, idle());
    expect(state.tide.active).toBe(true);
    expect(state.tide.ring).toBe(1);
    state.tick = state.tide.nextAdvanceTick - 1;
    simulateTick(state, idle());
    expect(state.tide.ring).toBe(2);
  });
});
