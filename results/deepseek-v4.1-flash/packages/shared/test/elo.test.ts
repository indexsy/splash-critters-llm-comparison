import { describe, expect, it } from "vitest";
import {
  duelDelta,
  expectedScore,
  ffaDeltas,
  kFactor,
  pairScore,
  tierOf,
} from "../src/elo.js";
import type { EloPlayer } from "../src/elo.js";

describe("Elo math", () => {
  it("uses the placement K-factor for the first ten games", () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(9)).toBe(64);
    expect(kFactor(10)).toBe(32);
  });

  it("matches a standard duel fixture", () => {
    const underdog: EloPlayer = { id: "underdog", rating: 1000, games: 20 };
    const favorite: EloPlayer = { id: "favorite", rating: 1200, games: 20 };
    expect(expectedScore(1000, 1200)).toBeCloseTo(0.240253, 5);
    expect(duelDelta(underdog, favorite, 1)).toBe(24);
    expect(duelDelta(favorite, underdog, 0)).toBe(-24);
    expect(duelDelta(underdog, favorite, 0)).toBe(-8);
  });

  it("matches a four-player pairwise fixture", () => {
    const players: EloPlayer[] = [
      { id: "a", rating: 1000, games: 20 },
      { id: "b", rating: 1100, games: 20 },
      { id: "c", rating: 1200, games: 20 },
      { id: "d", rating: 1300, games: 20 },
    ];
    const deltas = ffaDeltas(players, { a: 1, b: 2, c: 3, d: 4 });
    expect(deltas).toEqual({ a: 24, b: 8, c: -8, d: -24 });
    const total = Object.values(deltas).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });

  it("awards half scores for shared placements", () => {
    const players: EloPlayer[] = [
      { id: "a", rating: 1000, games: 20 },
      { id: "b", rating: 1100, games: 20 },
      { id: "c", rating: 1200, games: 20 },
      { id: "d", rating: 1300, games: 20 },
    ];
    expect(pairScore(1, 1)).toBe(0.5);
    expect(pairScore(1, 2)).toBe(1);
    expect(pairScore(3, 2)).toBe(0);
    const deltas = ffaDeltas(players, { a: 1, b: 1, c: 3, d: 4 });
    expect(deltas).toEqual({ a: 19, b: 13, c: -8, d: -24 });
  });

  it("maps rating tiers at the exact boundaries", () => {
    expect(tierOf(999)).toBe("PUDDLE");
    expect(tierOf(1000)).toBe("POND");
    expect(tierOf(1149)).toBe("POND");
    expect(tierOf(1150)).toBe("RIVER");
    expect(tierOf(1299)).toBe("RIVER");
    expect(tierOf(1300)).toBe("LAKE");
    expect(tierOf(1499)).toBe("LAKE");
    expect(tierOf(1500)).toBe("OCEAN");
    expect(tierOf(1749)).toBe("OCEAN");
    expect(tierOf(1750)).toBe("TSUNAMI");
  });
});
