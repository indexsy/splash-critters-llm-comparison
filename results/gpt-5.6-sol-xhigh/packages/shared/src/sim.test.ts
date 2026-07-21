import { describe, expect, it } from "vitest";
import { generateMap } from "./map.js";
import { createGameState, simulateTick } from "./sim.js";

describe("deterministic simulation", () => {
  it("generates identical maps and hidden contents from the same seed", () => {
    expect(generateMap(481516, "ffa")).toEqual(generateMap(481516, "ffa"));
  });

  it("stops a splash at the first sandcastle", () => {
    const state = createGameState(1, "duel", [{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    state.map.tiles = state.map.tiles.map((row) => row.map(() => 0 as const));
    state.map.tiles[1]![3] = 2;
    state.map.tiles[1]![4] = 2;
    state.balloons.push({ id: 1, ownerId: "a", x: 1, y: 1, placedAt: 0, burstAt: 0, range: 5, sliding: "none", nextSlideAt: 0, ownerMayPass: false });
    state.players[0]!.activeBalloons = 1;
    const { events } = simulateTick(state, []);
    expect(events).toContainEqual({ type: "castle_washed", x: 3, y: 1, ownerId: "a" });
    expect(state.map.tiles[1]![4]).toBe(2);
  });

  it("bursts a three-balloon chain in one tick", () => {
    const state = createGameState(2, "duel", [{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    state.map.tiles = state.map.tiles.map((row) => row.map(() => 0 as const));
    state.balloons = [
      { id: 1, ownerId: "a", x: 2, y: 3, placedAt: 0, burstAt: 0, range: 2, sliding: "none", nextSlideAt: 0, ownerMayPass: false },
      { id: 2, ownerId: "a", x: 4, y: 3, placedAt: 0, burstAt: 99, range: 2, sliding: "none", nextSlideAt: 0, ownerMayPass: false },
      { id: 3, ownerId: "b", x: 6, y: 3, placedAt: 0, burstAt: 99, range: 2, sliding: "none", nextSlideAt: 0, ownerMayPass: false }
    ];
    state.players[0]!.activeBalloons = 2;
    state.players[1]!.activeBalloons = 1;
    const { events } = simulateTick(state, []);
    expect(state.balloons).toHaveLength(0);
    expect(events.filter((event) => event.type === "chain_burst")).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "chain_burst", chain: 3 }));
  });

  it("keeps a power-up revealed by the current splash", () => {
    const state = createGameState(3, "duel", [{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    state.map.tiles = state.map.tiles.map((row) => row.map(() => 0 as const));
    state.map.tiles[1]![2] = 2;
    state.map.hiddenPowerups["2,1"] = "range";
    state.balloons.push({ id: 1, ownerId: "a", x: 1, y: 1, placedAt: 0, burstAt: 0, range: 2, sliding: "none", nextSlideAt: 0, ownerMayPass: false });
    state.players[0]!.activeBalloons = 1;
    simulateTick(state, []);
    expect(state.powerups).toContainEqual(expect.objectContaining({ x: 2, y: 1, kind: "range" }));
  });
});
