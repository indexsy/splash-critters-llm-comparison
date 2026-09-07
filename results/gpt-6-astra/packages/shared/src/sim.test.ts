import { describe, it, expect } from "vitest";
import { CONFIG } from "./config.js";
import { generateMap } from "./map.js";
import { mulberry32 } from "./rng.js";
import { createGame, simulateTick, cloneState } from "./sim.js";
import { Tile, type Balloon, type GameState } from "./types.js";

function empty(): GameState {
  const state = createGame({
    mode: "duel",
    seed: 5,
    players: [
      { id: "a", nickname: "A" },
      { id: "b", nickname: "B" },
    ],
  });
  state.tiles = state.tiles.map((t) => (t === Tile.Castle ? Tile.Floor : t));
  state.hiddenPowerups = {};
  return state;
}
function balloon(
  id: number,
  x: number,
  y: number,
  burstTick = 1,
  range = 2,
): Balloon {
  return {
    id,
    x,
    y,
    burstTick,
    range,
    ownerId: "a",
    placedTick: 0,
    passThrough: [],
    slideDir: "none",
    nextSlideTick: 0,
    revenge: false,
  };
}
describe("deterministic simulation", () => {
  it("replays RNG and map geometry plus secret loot", () => {
    const a = mulberry32(98);
    const b = mulberry32(98);
    expect(Array.from({ length: 100 }, a)).toEqual(
      Array.from({ length: 100 }, b),
    );
    expect(generateMap("ffa", 10, 200)).toEqual(generateMap("ffa", 10, 200));
    expect(generateMap("ffa", 10, 200).tiles).toEqual(
      generateMap("ffa", 10, 201).tiles,
    );
    expect(generateMap("ffa", 10, 200).hiddenPowerups).not.toEqual(
      generateMap("ffa", 10, 201).hiddenPowerups,
    );
  });
  it("bursts a three-balloon cascade in one tick using each range", () => {
    const s = empty();
    s.balloons = [
      balloon(1, 3, 3),
      balloon(2, 5, 3, 50, 3),
      balloon(3, 8, 3, 90, 1),
    ];
    simulateTick(s, {});
    expect(s.balloons).toHaveLength(0);
    expect(s.events).toContainEqual({
      type: "chain_burst",
      count: 3,
      playerId: "a",
      x: 3,
      y: 3,
    });
    expect(s.splashes.some((p) => p.x === 9 && p.y === 3)).toBe(true);
    expect(s.splashes.some((p) => p.x === 10 && p.y === 3)).toBe(false);
  });
  it("stops at the first castle and reveals pre-rolled contents", () => {
    const s = empty();
    s.tiles[3 * s.width + 5] = Tile.Castle;
    s.hiddenPowerups[3 * s.width + 5] = "kick";
    s.balloons = [balloon(1, 3, 3, 1, 6)];
    simulateTick(s, {});
    expect(s.tiles[3 * s.width + 5]).toBe(Tile.Floor);
    expect(s.splashes.some((p) => p.x === 6 && p.y === 3)).toBe(false);
    expect(s.powerups[0]?.kind).toBe("kick");
    s.balloons.push(balloon(2, 7, 3, 2, 2));
    simulateTick(s, {});
    expect(s.powerups).toHaveLength(0);
  });
  it("blocks boulders and makes simultaneous last soaks a draw", () => {
    const s = empty();
    s.players[0].x = 3.5;
    s.players[0].y = 3.5;
    s.players[1].x = 5.5;
    s.players[1].y = 3.5;
    s.balloons = [balloon(1, 4, 3)];
    simulateTick(s, {});
    expect(s.roundOver).toBe(true);
    expect(s.winnerId).toBeNull();
    expect(s.splashes.some((p) => p.x === 4 && p.y === 2)).toBe(false);
  });
  it("lets the owner leave a balloon but not re-enter it", () => {
    const s = empty();
    for (let i = 0; i < 9; i++)
      simulateTick(s, {
        a: { seq: i, tick: i, dir: "right", balloonPressed: i === 0 },
      });
    expect(s.players[0].x).toBeGreaterThan(2.5);
    expect(s.balloons[0].passThrough).toEqual([]);
    for (let i = 9; i < 20; i++)
      simulateTick(s, {
        a: { seq: i, tick: i, dir: "left", balloonPressed: false },
      });
    expect(s.players[0].x).toBeGreaterThanOrEqual(2 + CONFIG.PLAYER_RADIUS);
  });
  it("kicks slide until blocked, keeping the original fuse", () => {
    const s = empty();
    s.players[0].kick = true;
    s.balloons = [balloon(1, 2, 1, 50)];
    for (let i = 0; i < 10; i++)
      simulateTick(s, {
        a: { seq: i, tick: i, dir: "right", balloonPressed: false },
      });
    expect(s.balloons[0].x).toBeGreaterThan(2);
    expect(s.balloons[0].burstTick).toBe(50);
    expect(s.events.filter((e) => e.type === "balloon_burst")).toHaveLength(0);
  });
  it("advances rising tide and disables ranked revenge", () => {
    const s = empty();
    s.tick = CONFIG.TIDE_START_TICKS - 1;
    simulateTick(s, {});
    expect(s.tideRing).toBe(1);
    expect(s.players.every((p) => !p.alive)).toBe(true);
    expect(
      createGame({
        mode: "duel",
        seed: 1,
        ranked: true,
        revengeEnabled: true,
        players: [],
      }).revengeEnabled,
    ).toBe(false);
  });
  it("replays identical inputs without state divergence", () => {
    const a = empty();
    const b = cloneState(a);
    for (let tick = 0; tick < 100; tick++) {
      const inputs = {
        a: {
          tick,
          seq: tick,
          dir: "right" as const,
          balloonPressed: tick === 2,
        },
      };
      simulateTick(a, inputs);
      simulateTick(b, inputs);
      expect(a).toEqual(b);
    }
  });
});
