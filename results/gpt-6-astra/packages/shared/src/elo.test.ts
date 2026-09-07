import { expect, it } from "vitest";
import { calculateElo } from "./elo.js";
import { levelProgress, rankTier, xpForLevel } from "./config.js";
it.each([
  {
    ratings: [1000, 1000],
    games: [0, 0],
    placements: [1, 2],
    expected: [32, -32],
  },
  {
    ratings: [1000, 1000],
    games: [10, 10],
    placements: [1, 2],
    expected: [16, -16],
  },
  {
    ratings: [1200, 1000],
    games: [10, 10],
    placements: [1, 2],
    expected: [8, -8],
  },
  {
    ratings: [1000, 1000, 1000, 1000],
    games: [0, 0, 0, 0],
    placements: [1, 2, 3, 4],
    expected: [32, 11, -11, -32],
  },
  {
    ratings: [1000, 1000, 1000, 1000],
    games: [10, 10, 10, 10],
    placements: [1, 2, 2, 4],
    expected: [16, 0, 0, -16],
  },
  {
    ratings: [1000, 1000, 1000, 1000],
    games: [0, 0, 0, 0],
    placements: [1, 1, 1, 1],
    expected: [0, 0, 0, 0],
  },
])("Elo fixture $ratings / $placements", (fixture) => {
  const players = fixture.ratings.map((rating, i) => ({
    id: String(i),
    rating,
    games: fixture.games[i],
    placement: fixture.placements[i],
  }));
  expect(Object.values(calculateElo(players))).toEqual(fixture.expected);
});
it("uses cumulative level costs and configured tier boundaries", () => {
  expect(xpForLevel(1)).toBe(125);
  expect(levelProgress(125)).toEqual({ level: 2, current: 0, required: 150 });
  expect(rankTier(999).name).toBe("Puddle");
  expect(rankTier(1750).name).toBe("Tsunami");
});
