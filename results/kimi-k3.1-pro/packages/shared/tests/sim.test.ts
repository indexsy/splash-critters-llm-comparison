import { describe, expect, it } from "vitest";
import {
  CONFIG,
  TILE,
  createGameState,
  generateMap,
  mapIndex,
  mulberry32,
  simulateTick,
  snapshotState,
  traceSplash
} from "../src/index.js";
import type { BalloonState, GameState, MatchConfig, PlayerDescriptor } from "../src/index.js";

const players: PlayerDescriptor[] = [
  { id: "a", nickname: "Alpha", animal: "frog", hat: "none", bot: false },
  { id: "b", nickname: "Beta", animal: "duck", hat: "none", bot: false }
];

const config: MatchConfig = {
  mode: "duel",
  ranked: false,
  roundsToWin: 3,
  theme: "backyard",
  revengeDucks: false,
  kick: true,
  tutorial: false
};

function openState(): GameState {
  const state = createGameState(1234, config, players);
  state.phase = "playing";
  state.phaseTicks = 0;
  state.map.tiles.fill(TILE.FLOOR);
  state.map.hiddenPowerups.fill(null);
  for (let x = 0; x < state.map.width; x += 1) {
    state.map.tiles[mapIndex(state.map, x, 0)] = TILE.BOULDER;
    state.map.tiles[mapIndex(state.map, x, state.map.height - 1)] = TILE.BOULDER;
  }
  for (let y = 0; y < state.map.height; y += 1) {
    state.map.tiles[mapIndex(state.map, 0, y)] = TILE.BOULDER;
    state.map.tiles[mapIndex(state.map, state.map.width - 1, y)] = TILE.BOULDER;
  }
  state.players[0].x = 1;
  state.players[0].y = 1;
  state.players[1].x = state.map.width - 2;
  state.players[1].y = state.map.height - 2;
  state.balloons = [];
  return state;
}

function balloon(id: number, ownerId: string, x: number, y: number, fuse: number, range: number): BalloonState {
  return {
    id,
    ownerId,
    x,
    y,
    fuse,
    range,
    passThrough: [],
    kickDir: null,
    direction: "down",
    kickProgress: 0,
    straight: false,
    revenge: false
  };
}

describe("seeded generation", () => {
  it("mulberry32 reproduces the same sequence", () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    expect(Array.from({ length: 20 }, first)).toEqual(Array.from({ length: 20 }, second));
  });

  it("identical seeds produce identical maps and hidden power-ups", () => {
    const first = generateMap(13, 11, 982451653, "duel");
    const second = generateMap(13, 11, 982451653, "duel");
    expect(first.tiles).toEqual(second.tiles);
    expect(first.hiddenPowerups).toEqual(second.hiddenPowerups);
    expect(first.hiddenPowerups.some(Boolean)).toBe(true);
  });

  it("keeps spawn exits clear", () => {
    const map = generateMap(15, 13, 77, "ffa");
    for (const spawn of map.spawns) {
      expect(map.tiles[mapIndex(map, spawn.x, spawn.y)]).toBe(TILE.FLOOR);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let distance = 1; distance <= 2; distance += 1) {
          const x = spawn.x + dx * distance;
          const y = spawn.y + dy * distance;
          if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) continue;
          expect(map.tiles[mapIndex(map, x, y)]).toBe(TILE.FLOOR);
        }
      }
    }
  });
});

describe("balloons and splashes", () => {
  it("stops at the first sandcastle in each direction", () => {
    const state = openState();
    state.map.tiles[mapIndex(state.map, 7, 5)] = TILE.CASTLE;
    state.map.tiles[mapIndex(state.map, 8, 5)] = TILE.CASTLE;
    state.balloons.push(balloon(1, "a", 5, 5, 1, 4));
    simulateTick(state, {});
    expect(state.map.tiles[mapIndex(state.map, 7, 5)]).toBe(TILE.FLOOR);
    expect(state.map.tiles[mapIndex(state.map, 8, 5)]).toBe(TILE.CASTLE);
    expect(state.splashes.some((splash) => splash.x === 7 && splash.y === 5)).toBe(true);
    expect(state.splashes.some((splash) => splash.x === 8 && splash.y === 5)).toBe(false);
  });

  it("resolves a three-balloon chain in one tick with escalating depths", () => {
    const state = openState();
    state.balloons.push(balloon(1, "a", 3, 3, 1, 1));
    state.balloons.push(balloon(2, "b", 4, 3, 40, 1));
    state.balloons.push(balloon(3, "b", 5, 3, 50, 1));
    const events = simulateTick(state, {});
    expect(state.balloons).toHaveLength(0);
    expect(events.filter((event) => event.type === "chain_burst").map((event) => event.type === "chain_burst" ? event.depth : 0)).toEqual([1, 2]);
    expect(state.players[0].biggestChain).toBe(3);
  });

  it("uses each chained balloon's own range", () => {
    const state = openState();
    state.map.tiles[mapIndex(state.map, 7, 3)] = TILE.CASTLE;
    state.balloons.push(balloon(1, "a", 3, 3, 1, 1));
    state.balloons.push(balloon(2, "b", 4, 3, 40, 3));
    simulateTick(state, {});
    expect(state.map.tiles[mapIndex(state.map, 7, 3)]).toBe(TILE.FLOOR);
  });

  it("reveals the pre-rolled contents when a castle washes away", () => {
    const state = openState();
    const index = mapIndex(state.map, 5, 3);
    state.map.tiles[index] = TILE.CASTLE;
    state.map.hiddenPowerups[index] = "speed";
    state.balloons.push(balloon(1, "a", 3, 3, 1, 2));
    const events = simulateTick(state, {});
    expect(events).toContainEqual(expect.objectContaining({ type: "powerup_revealed", tick: 1, x: 5, y: 3, kind: "speed" }));
    expect(state.powerups[0]?.kind).toBe("speed");
    expect(state.map.hiddenPowerups[index]).toBeNull();
  });

  it("soaks the last two players on the same tick as a draw", () => {
    const state = openState();
    state.players[0].x = 3;
    state.players[0].y = 3;
    state.players[1].x = 4;
    state.players[1].y = 3;
    state.balloons.push(balloon(1, "a", 3, 3, 1, 1));
    simulateTick(state, {});
    expect(state.phase).toBe("round_end");
    expect(state.roundWinnerId).toBeNull();
    expect(state.players.map((player) => player.roundsWon)).toEqual([0, 0]);
  });

  it("slides kicked balloons without resetting their fuse", () => {
    const state = openState();
    const player = state.players[0];
    player.x = 3;
    player.y = 3;
    player.kick = true;
    state.balloons.push(balloon(1, "b", 4, 3, 80, 2));
    simulateTick(state, { a: { seq: 1, dir: "right", balloonPressed: false } });
    const events = simulateTick(state, { a: { seq: 2, dir: "right", balloonPressed: false } });
    expect(events.some((event) => event.type === "balloon_kicked")).toBe(true);
    const kicked = state.balloons[0];
    const startX = kicked.x;
    const fuse = kicked.fuse;
    for (let tick = 0; tick < 5; tick += 1) simulateTick(state, {});
    expect(state.balloons[0].x).toBeGreaterThan(startX);
    expect(state.balloons[0].fuse).toBe(fuse - 5);
  });
});

describe("round systems", () => {
  it("advances the rising tide and soaks flooded players", () => {
    const state = openState();
    state.tick = CONFIG.TIDE_START_TICKS - 1;
    const events = simulateTick(state, {});
    expect(state.tideRing).toBe(1);
    expect(events.some((event) => event.type === "tide_advance")).toBe(true);
    expect(state.players.every((player) => !player.alive)).toBe(true);
    expect(state.phase).toBe("round_end");
  });

  it("replays identical inputs deterministically", () => {
    const first = openState();
    const second = openState();
    const random = mulberry32(999);
    const directions = ["none", "up", "down", "left", "right"] as const;
    for (let tick = 0; tick < 180 && first.phase !== "round_end"; tick += 1) {
      const inputs = {
        a: { seq: tick + 1, dir: directions[Math.floor(random() * directions.length)], balloonPressed: random() < 0.08 },
        b: { seq: tick + 1, dir: directions[Math.floor(random() * directions.length)], balloonPressed: random() < 0.08 }
      };
      simulateTick(first, inputs);
      simulateTick(second, structuredClone(inputs));
    }
    expect(snapshotState(first)).toEqual(snapshotState(second));
    expect(first.map.hiddenPowerups).toEqual(second.map.hiddenPowerups);
  });

  it("traces splash paths without crossing boulders", () => {
    const state = openState();
    state.map.tiles[mapIndex(state.map, 5, 3)] = TILE.BOULDER;
    const cells = traceSplash(state.map, 3, 3, 4);
    expect(cells).toContainEqual({ x: 4, y: 3 });
    expect(cells).not.toContainEqual({ x: 5, y: 3 });
    expect(cells).not.toContainEqual({ x: 6, y: 3 });
  });
});
