import { describe, expect, it } from "vitest";
import { applyDuelElo, applyFfaElo, computePlacements, expectedScore, kFactor } from "../src/elo";
import { CONFIG, tierFor } from "../src/config";

describe("elo basics", () => {
  it("expected score symmetric", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(expectedScore(1100, 1000)).toBeGreaterThan(0.5);
  });

  it("K factor fresh vs normal", () => {
    expect(kFactor(0)).toBe(CONFIG.eloKFresh);
    expect(kFactor(CONFIG.freshGamesThreshold)).toBe(CONFIG.eloKNormal);
  });

  it("duel fixture: equal ratings, winner gains ~16 (K32)", () => {
    const [w, l] = applyDuelElo(
      [{ games: 50, rating: 1000 }, { games: 50, rating: 1000 }],
      [1, 0],
    );
    expect(w.after).toBe(1016);
    expect(l.after).toBe(984);
  });

  it("duel fixture: upset win gives bigger gain", () => {
    const [w] = applyDuelElo([{ games: 50, rating: 1000 }, { games: 50, rating: 1200 }], [1, 0]);
    const expectedGain = Math.round(32 * (1 - expectedScore(1000, 1200)));
    expect(w.after).toBe(1000 + expectedGain);
  });

  it("duel fixture: first 10 games use K=64", () => {
    const [w] = applyDuelElo([{ games: 3, rating: 1000 }, { games: 30, rating: 1000 }], [1, 0]);
    expect(w.after).toBe(1032);
  });
});

describe("ffa pairwise elo fixtures", () => {
  it("clean 1st/2nd/3rd/4th among equal 1000s sums deltas ≈ 0 and favors winner", () => {
    const res = applyFfaElo([
      { games: 90, rating: 1000, placement: 1 },
      { games: 90, rating: 1000, placement: 2 },
      { games: 90, rating: 1000, placement: 3 },
      { games: 90, rating: 1000, placement: 4 },
    ]);
    const sum = res.reduce((a, r) => a + r.delta, 0);
    expect(sum).toBe(0);
    expect(res[0]!.delta).toBeGreaterThan(res[1]!.delta);
    expect(res[1]!.delta).toBeGreaterThan(res[2]!.delta);
    expect(res[2]!.delta).toBeGreaterThan(res[3]!.delta);
    // each pair K' = K/3; perfect sweep: delta = Σ K'(S−E) = 3 × (32/3)(1−0.5) = 16
    expect(res[0]!.after).toBe(1016);
    expect(res[3]!.after).toBe(984);
  });

  it("tied placements share 0.5 scores", () => {
    const res = applyFfaElo([
      { games: 90, rating: 1000, placement: 1 },
      { games: 90, rating: 1000, placement: 2 },
      { games: 90, rating: 1000, placement: 2 },
      { games: 90, rating: 1000, placement: 4 },
    ]);
    const sum = res.reduce((a, r) => a + r.delta, 0);
    expect(sum).toBe(0);
    expect(res[1]!.delta).toBeCloseTo(res[2]!.delta, 5);
  });

  it("rating differences affect pairwise expectations", () => {
    const res = applyFfaElo([
      { games: 90, rating: 1400, placement: 1 },
      { games: 90, rating: 1000, placement: 2 },
      { games: 90, rating: 1000, placement: 3 },
      { games: 90, rating: 1000, placement: 4 },
    ]);
    // favorite winning gains less than underdog sweeping would
    expect(res[0]!.delta).toBeGreaterThan(0);
    expect(res[0]!.delta).toBeLessThan(16);
    expect(res[3]!.delta).toBeLessThan(-8);
  });
});

describe("placements", () => {
  it("round wins then soaks tiebreak; ties share placement", () => {
    const out = computePlacements([
      { entityId: "a", roundsWon: 2, soaks: 1 },
      { entityId: "b", roundsWon: 3, soaks: 0 },
      { entityId: "c", roundsWon: 2, soaks: 5 },
      { entityId: "d", roundsWon: 2, soaks: 5 },
    ]);
    const byId = Object.fromEntries(out.map((o) => [o.entityId, o.placement]));
    expect(byId["b"]).toBe(1);
    expect(byId["c"]).toBe(2);
    expect(byId["d"]).toBe(2);
    expect(byId["a"]).toBe(4);
  });
});

describe("tiers", () => {
  it("bands match spec", () => {
    expect(tierFor(500)).toBe("Puddle");
    expect(tierFor(1000)).toBe("Pond");
    expect(tierFor(1149)).toBe("Pond");
    expect(tierFor(1150)).toBe("River");
    expect(tierFor(1300)).toBe("Lake");
    expect(tierFor(1500)).toBe("Ocean");
    expect(tierFor(1750)).toBe("Tsunami");
  });
});
