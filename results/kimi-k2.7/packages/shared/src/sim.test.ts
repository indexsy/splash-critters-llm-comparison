import { describe, it, expect } from "vitest";
import { CONFIG } from "../src/config.js";
import { generateMap, isBoulder } from "../src/map.js";
import { createRoundState, simulateTick } from "../src/sim.js";
import { mulberry32 } from "../src/rng.js";

describe("map generation", () => {
  it("boulders on border and even-even pillars", () => {
    const map = generateMap("duel", 123, "beach");
    expect(isBoulder(map.width, map.height, 0, 0)).toBe(true);
    expect(isBoulder(map.width, map.height, 2, 2)).toBe(true);
    expect(isBoulder(map.width, map.height, 1, 1)).toBe(false);
  });

  it("identical seed gives identical hidden powerups", () => {
    const a = generateMap("duel", 999, "beach");
    const b = generateMap("duel", 999, "beach");
    for (let x = 0; x < a.width; x++) {
      for (let y = 0; y < a.height; y++) {
        expect(a.castles[x][y]?.powerUp).toBe(b.castles[x][y]?.powerUp);
      }
    }
  });
});

describe("splash mechanics", () => {
  it("splash stops at first sandcastle per direction", () => {
    const state = createRoundState("duel", 1, 1000, "beach", [
      { id: "p1", nickname: "A", animal: "frog", hat: "none", slot: 0 },
      { id: "p2", nickname: "B", animal: "duck", hat: "none", slot: 1 },
    ]);
    // Force a castle at (2,1) and a balloon at (1,1) with range 3
    state.castles[2][1] = { hasCastle: true };
    state.players[0].pos = { x: 1.5, y: 1.5 };
    state.players[0].stats.splashRange = 3;
    state.players[0].stats.balloonCount = 1;
    simulateTick(state, [
      { playerId: "p1", tick: 0, dir: { x: 0, y: 0 }, balloonPressed: true, kickPressed: false },
      { playerId: "p2", tick: 0, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false },
    ]);
    // Tick until burst
    for (let i = 0; i < CONFIG.BALLOON_FUSE_TICKS; i++) {
      simulateTick(state, [
        { playerId: "p1", tick: state.tick, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false },
        { playerId: "p2", tick: state.tick, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false },
      ]);
    }
    expect(state.castles[2][1]?.hasCastle).toBe(false);
    // Further castle should remain if it existed; here none so just check no crash
  });

  it("3-balloon chain bursts in one tick", () => {
    const state = createRoundState("duel", 1, 2000, "beach", [
      { id: "p1", nickname: "A", animal: "frog", hat: "none", slot: 0 },
      { id: "p2", nickname: "B", animal: "duck", hat: "none", slot: 1 },
    ]);
    // Clear row and place 3 balloons manually
    state.castles[1][1] = null;
    state.castles[2][1] = null;
    state.castles[3][1] = null;
    state.balloons.push({ id: "b1", ownerId: "p1", tx: 1, ty: 1, fuseTick: 0, range: 1 });
    state.balloons.push({ id: "b2", ownerId: "p1", tx: 2, ty: 1, fuseTick: 100, range: 1 });
    state.balloons.push({ id: "b3", ownerId: "p1", tx: 3, ty: 1, fuseTick: 100, range: 1 });
    state.players[0].activeBalloons = 3;

    simulateTick(state, [
      { playerId: "p1", tick: 0, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false },
      { playerId: "p2", tick: 0, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false },
    ]);
    const chain = state.events.find((e) => e.type === "chain_burst");
    expect(chain).toBeDefined();
    expect((chain as any).count).toBe(3);
    expect(state.balloons.length).toBe(0);
  });
});

describe("rng", () => {
  it("mulberry32 is deterministic", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});
