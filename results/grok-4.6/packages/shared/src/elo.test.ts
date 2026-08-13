import { describe, expect, it } from "vitest";
import { applyDuelElo, applyFfaElo, expectedScore, kFactor } from "./elo.js";
import { CONFIG, tierForRating } from "./config.js";

describe("Elo math", () => {
  it("equal ratings have expected 0.5", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it("provisional K is 64 then 32", () => {
    expect(kFactor(0)).toBe(CONFIG.ELO_K_PROVISIONAL);
    expect(kFactor(9)).toBe(CONFIG.ELO_K_PROVISIONAL);
    expect(kFactor(10)).toBe(CONFIG.ELO_K_STANDARD);
  });

  it("duel fixture: equal 1000 first game winner +32 loser -32", () => {
    const r = applyDuelElo(
      { id: "w", rating: 1000, games: 0, placement: 1 },
      { id: "l", rating: 1000, games: 0, placement: 2 },
    );
    expect(r[0]!.delta).toBe(32);
    expect(r[1]!.delta).toBe(-32);
    expect(r[0]!.after).toBe(1032);
    expect(r[1]!.after).toBe(968);
  });

  it("duel fixture: established equal ratings winner +16 loser -16", () => {
    const r = applyDuelElo(
      { id: "w", rating: 1200, games: 20, placement: 1 },
      { id: "l", rating: 1200, games: 20, placement: 2 },
    );
    expect(r[0]!.delta).toBe(16);
    expect(r[1]!.delta).toBe(-16);
  });

  it("4p pairwise: placements 1-4 equal 1000 provisional", () => {
    const players = [
      { id: "a", rating: 1000, games: 0, placement: 1 },
      { id: "b", rating: 1000, games: 0, placement: 2 },
      { id: "c", rating: 1000, games: 0, placement: 3 },
      { id: "d", rating: 1000, games: 0, placement: 4 },
    ];
    const r = applyFfaElo(players);
    const byId = Object.fromEntries(r.map((x) => [x.id, x.delta]));
    expect(byId.a).toBe(32);
    expect(byId.b).toBe(11);
    expect(byId.c).toBe(-11);
    expect(byId.d).toBe(-32);
  });

  it("tied placements share score 0.5", () => {
    const r = applyFfaElo([
      { id: "a", rating: 1000, games: 20, placement: 1 },
      { id: "b", rating: 1000, games: 20, placement: 1 },
      { id: "c", rating: 1000, games: 20, placement: 3 },
      { id: "d", rating: 1000, games: 20, placement: 4 },
    ]);
    expect(r[0]!.delta).toBe(r[1]!.delta);
  });

  it("tier bands", () => {
    expect(tierForRating(999).id).toBe("puddle");
    expect(tierForRating(1000).id).toBe("pond");
    expect(tierForRating(1150).id).toBe("river");
    expect(tierForRating(1300).id).toBe("lake");
    expect(tierForRating(1500).id).toBe("ocean");
    expect(tierForRating(1750).id).toBe("tsunami");
  });
});
