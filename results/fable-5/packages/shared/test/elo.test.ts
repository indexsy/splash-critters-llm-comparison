import { describe, expect, it } from "vitest";
import { duelElo, expectedScore, ffaElo, ffaPlacements, kFactor } from "../src/elo.js";
import { levelForXp, tierForRating, xpForLevel } from "../src/config.js";

describe("duel Elo fixtures", () => {
  it("even match, established players: winner +16 / loser -16", () => {
    expect(duelElo(1000, 1000, true, 20, 20)).toEqual([16, -16]);
    expect(duelElo(1000, 1000, false, 20, 20)).toEqual([-16, 16]);
  });

  it("new players use K=64 for their first 10 games", () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(9)).toBe(64);
    expect(kFactor(10)).toBe(32);
    expect(duelElo(1000, 1000, true, 0, 0)).toEqual([32, -32]);
  });

  it("favorite beating underdog gains little: 1200 beats 1000 → +8/-8", () => {
    expect(duelElo(1200, 1000, true, 20, 20)).toEqual([8, -8]);
  });

  it("upset pays out: 1000 beats 1200 → +24/-24", () => {
    expect(duelElo(1000, 1200, true, 20, 20)).toEqual([24, -24]);
  });

  it("expected score is symmetric", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1);
  });
});

describe("FFA pairwise Elo fixtures", () => {
  it("equal ratings, clean 1-2-3-4: [+16, +5, -5, -16]", () => {
    const e = (placement: number) => ({ rating: 1000, games: 20, placement });
    expect(ffaElo([e(1), e(2), e(3), e(4)])).toEqual([16, 5, -5, -16]);
  });

  it("shared 2nd place: the tied pair scores 0.5 against each other", () => {
    const e = (placement: number) => ({ rating: 1000, games: 20, placement });
    expect(ffaElo([e(1), e(2), e(2), e(4)])).toEqual([16, 0, 0, -16]);
  });

  it("zero-sum for equal-K lobbies", () => {
    const deltas = ffaElo([
      { rating: 1100, games: 30, placement: 3 },
      { rating: 950, games: 30, placement: 1 },
      { rating: 1000, games: 30, placement: 2 },
      { rating: 1300, games: 30, placement: 4 },
    ]);
    const sum = deltas.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThanOrEqual(2); // integer rounding only
    expect(deltas[1]).toBeGreaterThan(0); // underdog winner gains most
    expect(deltas[3]).toBeLessThan(0); // favorite in last loses most
  });
});

describe("FFA placements", () => {
  it("orders by round wins, tiebreaks by soaks, shares unresolved ties", () => {
    expect(
      ffaPlacements([
        { roundsWon: 3, soaks: 5 },
        { roundsWon: 2, soaks: 7 },
        { roundsWon: 2, soaks: 7 },
        { roundsWon: 0, soaks: 1 },
      ])
    ).toEqual([1, 2, 2, 4]);
    expect(
      ffaPlacements([
        { roundsWon: 0, soaks: 0 },
        { roundsWon: 3, soaks: 2 },
        { roundsWon: 1, soaks: 4 },
        { roundsWon: 1, soaks: 2 },
      ])
    ).toEqual([4, 1, 2, 3]);
  });
});

describe("tiers & levels", () => {
  it("tier bands match the spec", () => {
    expect(tierForRating(999)).toBe("Puddle");
    expect(tierForRating(1000)).toBe("Pond");
    expect(tierForRating(1149)).toBe("Pond");
    expect(tierForRating(1150)).toBe("River");
    expect(tierForRating(1300)).toBe("Lake");
    expect(tierForRating(1500)).toBe("Ocean");
    expect(tierForRating(1750)).toBe("Tsunami");
    expect(tierForRating(2400)).toBe("Tsunami");
  });

  it("level curve: xpForLevel(n) = 100 + 25n", () => {
    expect(xpForLevel(1)).toBe(125);
    expect(xpForLevel(4)).toBe(200);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(125)).toBe(2);
    expect(levelForXp(124)).toBe(1);
  });
});
