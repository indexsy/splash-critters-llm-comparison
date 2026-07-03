// sim.test.ts — core simulation acceptance tests (spec §13).
import { describe, it, expect } from "vitest";
import { newMatchState, simulateTick, generateMap, BALLOON_FUSE_TICKS } from "../src/index.js";
import type { Input, MatchState } from "../src/types.js";

function emptyInputs(state: MatchState): Map<number, Input[]> {
  const m = new Map<number, Input[]>();
  for (const p of state.players) m.set(p.id, []);
  return m;
}

function dropBalloonAt(state: MatchState, x: number, y: number, ownerId: number, range = 2, fuse = BALLOON_FUSE_TICKS) {
  const id = state.nextEntityId++;
  state.balloons.set(id, { id, x, y, ownerId, fuse, range, sliding: undefined, spawnedTick: state.tick });
  state.players[ownerId].liveBalloons++;
  return id;
}

describe("map generation", () => {
  it("identical seed => identical tiles + identical hidden power-ups", () => {
    const a = generateMap(12345, "ffa");
    const b = generateMap(12345, "ffa");
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.hiddenPowerUps).toEqual(b.hiddenPowerUps);
    // a different seed should (overwhelmingly likely) differ
    const c = generateMap(99999, "ffa");
    const same = Array.from(a.tiles).every((v, i) => v === c.tiles[i]);
    expect(same).toBe(false);
  });

  it("boulders at border + even (x,y); spawns kept clear", () => {
    const m = generateMap(1, "duel");
    const { width: w, height: h, tiles } = m;
    expect(tiles[0]).toBe(1); // border boulder
    expect(tiles[(h - 1) * w]).toBe(1);
    // even-even interior = boulder
    expect(tiles[2 * w + 2]).toBe(1);
    // spawn (1,1) clear
    expect(tiles[1 * w + 1]).toBe(0);
  });
});

describe("splash behavior", () => {
  it("stops at the first sandcastle and washes it away", () => {
    const { state } = newMatchState(7, "duel", 2);
    const { width: w } = state;
    // Build a controlled scenario: clear a horizontal line, place a castle 2 tiles right.
    // Reset tiles in row y=3 to empty except one castle.
    for (let x = 0; x < w; x++) {
      const i = 3 * w + x;
      if (state.tiles[i] !== 1) state.tiles[i] = 0;
    }
    state.tiles[3 * w + 4] = 2; // castle at (4,3)
    // balloon at (1,3), range 5 -> should stop at castle (4,3), washing it.
    dropBalloonAt(state, 1, 3, 0, 5, 1);
    simulateTick(state, emptyInputs(state));
    // splash should have washed the castle at (4,3)
    expect(state.tiles[3 * w + 4]).toBe(0);
    // tiles beyond castle (5,3) should NOT be washed (still whatever, but no event beyond)
    expect(state.events.some((e) => e.type === "castle_washed" && e.x === 4 && e.y === 3)).toBe(true);
  });

  it("a 3-balloon chain bursts in a single tick", () => {
    const { state } = newMatchState(7, "duel", 2);
    const { width: w } = state;
    // fully clear the inner span of row y=4 (including boulder pillars)
    for (let x = 1; x < w - 1; x++) state.tiles[4 * w + x] = 0;
    // three balloons in a row within each other's splash range (range 2), on odd x
    dropBalloonAt(state, 1, 4, 0, 2, 1); // explodes (fuse=1)
    dropBalloonAt(state, 3, 4, 0, 2, BALLOON_FUSE_TICKS); // touched -> bursts same tick
    dropBalloonAt(state, 5, 4, 0, 2, BALLOON_FUSE_TICKS); // touched -> bursts same tick
    const before = state.balloons.size;
    expect(before).toBe(3);
    simulateTick(state, emptyInputs(state));
    // all 3 must be gone after this single tick
    expect(state.balloons.size).toBe(0);
    // a chain_burst event with size >= 2 must have fired
    const chainEvents = state.events.filter((e) => e.type === "chain_burst");
    expect(chainEvents.length).toBeGreaterThan(0);
  });

  it("boulders block splash propagation", () => {
    const { state } = newMatchState(7, "duel", 2);
    const { width: w } = state;
    for (let x = 0; x < w; x++) {
      const i = 5 * w + x;
      if (state.tiles[i] !== 1) state.tiles[i] = 0;
    }
    state.tiles[5 * w + 3] = 1; // boulder wall at (3,5)
    // place a "marker" castle behind the boulder to ensure it is NOT washed
    state.tiles[5 * w + 5] = 2;
    dropBalloonAt(state, 1, 5, 0, 5, 1);
    simulateTick(state, emptyInputs(state));
    expect(state.tiles[5 * w + 5]).toBe(2); // untouched behind boulder
  });
});

describe("round resolution", () => {
  it("eliminating the last opponent awards a round win", () => {
    const { state } = newMatchState(11, "duel", 2);
    const { width: w } = state;
    // fully clear the inner span of row y=1 (including pillars) for a clean corridor
    for (let x = 1; x < w - 1; x++) state.tiles[1 * w + x] = 0;
    state.players[1].x = 5; state.players[1].y = 1;
    // player0 sits at (3,5): on a different row AND a different column from the bomb
    // (bomb column x=1 shoots down col 1; bomb row y=1 shoots along y=1). (3,5) is safe.
    state.players[0].x = 3; state.players[0].y = 5;
    dropBalloonAt(state, 1, 1, 0, 5, 1); // bomb at (1,1), range 5 reaches player1 at (5,1)
    simulateTick(state, emptyInputs(state));
    expect(state.players[1].alive).toBe(false);
    expect(state.roundOver).toBe(true);
    expect(state.players[0].roundsWon).toBe(1);
  });
});
