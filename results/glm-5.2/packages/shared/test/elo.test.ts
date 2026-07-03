// elo.test.ts — Elo math fixtures (spec §13).
import { describe, it, expect } from "vitest";
import { eloDuel, eloFFA, expected, kFactor, ELO } from "../src/index.js";

describe("Elo", () => {
  it("K is provisional for first 10 games, then normal", () => {
    expect(kFactor(0)).toBe(ELO.KProvisional);
    expect(kFactor(9)).toBe(ELO.KProvisional);
    expect(kFactor(10)).toBe(ELO.KNormal);
  });

  it("Duel: equal ratings, winner gains exactly K/2 when provisional... actually expected=0.5 so delta=K*0.5", () => {
    // equal ratings → expected = 0.5; winner score 1 → delta = K*(1-0.5) = K/2
    const r = eloDuel(1000, 1000, 0, 1);
    expect(r.deltaA).toBe(Math.round(ELO.KProvisional * 0.5)); // 32
    expect(r.deltaB).toBe(Math.round(-ELO.KProvisional * 0.5)); // -32
    expect(r.newA).toBe(1032);
    expect(r.newB).toBe(968);
  });

  it("Duel: higher-rated winner gains less", () => {
    const r = eloDuel(1400, 1000, 20, 1); // both non-provisional
    expect(r.deltaA).toBeGreaterThan(0);
    expect(r.deltaA).toBeLessThan(8); // small gain vs much lower rated
    expect(r.deltaB).toBe(-r.deltaA);
  });

  it("FFA pairwise: symmetric field, 1st place gains, last loses", () => {
    const ratings = [1000, 1000, 1000, 1000];
    const games = [20, 20, 20, 20];
    const placements = [1, 2, 3, 4]; // strict order, player 0 wins
    const deltas = eloFFA(ratings, games, placements);
    expect(deltas[0]).toBeGreaterThan(0);
    expect(deltas[3]).toBeLessThan(0);
    // monotonic by placement in a symmetric field
    expect(deltas[0]).toBeGreaterThan(deltas[1]);
    expect(deltas[1]).toBeGreaterThan(deltas[2]);
    expect(deltas[2]).toBeGreaterThan(deltas[3]);
    // zero-sum over the field (pairwise Elo conserves total)
    const sum = deltas.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThanOrEqual(2); // rounding
  });

  it("FFA pairwise: tied placements produce equal deltas", () => {
    const ratings = [1000, 1000, 1000, 1000];
    const games = [20, 20, 20, 20];
    const placements = [1, 2, 2, 3]; // players 1 & 2 tie for 2nd
    const deltas = eloFFA(ratings, games, placements);
    expect(deltas[1]).toBe(deltas[2]); // tied players get identical deltas
  });

  it("expected() sanity", () => {
    expect(expected(1000, 1000)).toBeCloseTo(0.5, 5);
    expect(expected(1400, 1000)).toBeGreaterThan(0.9);
    expect(expected(1000, 1400)).toBeLessThan(0.1);
  });
});
