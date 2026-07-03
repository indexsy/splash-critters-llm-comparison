import { describe, it, expect } from "vitest";
import { duelDelta, ffaPairwiseDeltas } from "../src/elo.js";

describe("elo", () => {
  it("duel: equal ratings gives zero net", () => {
    const d = duelDelta(1000, 1000, 1, 0);
    expect(d).toBe(32);
  });

  it("ffa pairwise sum close to zero", () => {
    const ratings = { a: 1000, b: 1000, c: 1000, d: 1000 };
    const games = { a: 0, b: 0, c: 0, d: 0 };
    const placements = [
      { playerId: "a", roundsWon: 3, soaks: 2 },
      { playerId: "b", roundsWon: 1, soaks: 1 },
      { playerId: "c", roundsWon: 0, soaks: 1 },
      { playerId: "d", roundsWon: 0, soaks: 0 },
    ];
    const deltas = ffaPairwiseDeltas(ratings, games, placements);
    const sum = Object.values(deltas).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
    expect(deltas.a).toBeGreaterThan(0);
    expect(deltas.d).toBeLessThan(0);
  });
});
