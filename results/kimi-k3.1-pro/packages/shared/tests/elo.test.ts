import { describe, expect, it } from "vitest";
import { duelDeltas, expectedScore, ffaDeltas, levelForXp, tierFor, xpForLevel } from "../src/elo.js";

describe("Elo fixtures", () => {
  it("computes standard duel deltas", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(duelDeltas(1000, 1000, 1, 20, 20)).toEqual([16, -16]);
    expect(duelDeltas(1000, 1000, 0, 20, 20)).toEqual([-16, 16]);
  });

  it("uses provisional K independently", () => {
    expect(duelDeltas(1000, 1000, 1, 0, 20)).toEqual([32, -16]);
  });

  it("computes four-player pairwise deltas", () => {
    expect(ffaDeltas([1000, 1000, 1000, 1000], [1, 2, 3, 4], [20, 20, 20, 20])).toEqual([16, 5, -5, -16]);
    expect(ffaDeltas([1000, 1000, 1000, 1000], [1, 2, 3, 4], [0, 0, 0, 0])).toEqual([32, 11, -11, -32]);
  });

  it("shares tied placements", () => {
    expect(ffaDeltas([1000, 1000, 1000, 1000], [1, 1, 1, 1], [20, 20, 20, 20])).toEqual([0, 0, 0, 0]);
    expect(ffaDeltas([1000, 1000, 1000, 1000], [1, 1, 3, 3], [20, 20, 20, 20])).toEqual([11, 11, -11, -11]);
  });
});

describe("tiers and levels", () => {
  it("maps ratings to tier bands", () => {
    expect(tierFor(999)).toBe("Puddle");
    expect(tierFor(1000)).toBe("Pond");
    expect(tierFor(1750)).toBe("Tsunami");
  });

  it("uses the configured level curve", () => {
    expect(xpForLevel(1)).toBe(125);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(125)).toBe(2);
  });
});
