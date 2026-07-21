import { describe, expect, it } from "vitest";
import { duelElo, ffaElo } from "./elo.js";

describe("Elo", () => {
  it("applies provisional duel K factors", () => {
    expect(duelElo({ id: "a", rating: 1000, games: 0 }, { id: "b", rating: 1000, games: 0 }, "a")).toEqual([
      { id: "a", before: 1000, after: 1032, delta: 32 },
      { id: "b", before: 1000, after: 968, delta: -32 }
    ]);
  });

  it("uses pairwise scores for four equal-rated FFA players", () => {
    const result = ffaElo([
      { id: "a", rating: 1000, games: 12, placement: 1 },
      { id: "b", rating: 1000, games: 12, placement: 2 },
      { id: "c", rating: 1000, games: 12, placement: 3 },
      { id: "d", rating: 1000, games: 12, placement: 4 }
    ]);
    expect(result.map((entry) => entry.delta)).toEqual([16, 5, -5, -16]);
  });

  it("scores tied placements as half", () => {
    const result = ffaElo([
      { id: "a", rating: 1000, games: 12, placement: 1 },
      { id: "b", rating: 1000, games: 12, placement: 2 },
      { id: "c", rating: 1000, games: 12, placement: 2 },
      { id: "d", rating: 1000, games: 12, placement: 4 }
    ]);
    expect(result.map((entry) => entry.delta)).toEqual([16, 0, 0, -16]);
  });
});
