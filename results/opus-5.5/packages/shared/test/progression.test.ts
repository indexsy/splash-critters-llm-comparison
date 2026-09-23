import { describe, expect, it } from 'vitest';
import { computeMatchXp, levelFromXp, unlocksBetween, xpForLevel } from '../src/progression';
import { CONFIG } from '../src/config';

/** Lifetime XP needed to reach `level` from level 1. */
const totalXpFor = (level: number) => {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpForLevel(n);
  return total;
};

describe('level curve', () => {
  it('xpForLevel(n) = 100 + 25n', () => {
    expect(xpForLevel(1)).toBe(125);
    expect(xpForLevel(2)).toBe(150);
    expect(xpForLevel(10)).toBe(350);
  });

  it('levelFromXp starts at level 1 and walks the curve', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 125 });
    expect(levelFromXp(124)).toEqual({ level: 1, xpIntoLevel: 124, xpForNext: 125 });
    expect(levelFromXp(125)).toEqual({ level: 2, xpIntoLevel: 0, xpForNext: 150 });
    expect(levelFromXp(300)).toEqual({ level: 3, xpIntoLevel: 25, xpForNext: 175 });
  });

  it('hits the documented cumulative thresholds', () => {
    expect(totalXpFor(10)).toBe(2025);
    expect(totalXpFor(20)).toBe(6650);
    expect(levelFromXp(6649).level).toBe(19);
    expect(levelFromXp(6650).level).toBe(20);
  });

  it('clamps invalid totals to level 1', () => {
    expect(levelFromXp(-50)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 125 });
    expect(levelFromXp(Number.NaN).level).toBe(1);
    expect(levelFromXp(125.9)).toEqual({ level: 2, xpIntoLevel: 0, xpForNext: 150 });
  });
});

describe('computeMatchXp', () => {
  const base = { placement: 1, playerCount: 4, roundsWon: 3, soaks: 4, castles: 20, practice: false, forfeited: false };
  const sum = (lines: { xp: number }[]) => lines.reduce((s, l) => s + l.xp, 0);

  it('adds participation + placement + round wins + soaks + castles', () => {
    const xp = computeMatchXp(base);
    // 40 + 100 + 3*15 + 4*12 + 20*1
    expect(xp.earned).toBe(253);
    expect(xp.breakdown).toEqual([
      { label: 'Participation', xp: 40 },
      { label: 'Placement', xp: 100 },
      { label: 'Round wins', xp: 45 },
      { label: 'Soaks', xp: 48 },
      { label: 'Castles washed', xp: 20 },
    ]);
    expect(sum(xp.breakdown)).toBe(xp.earned);
  });

  it('caps castle XP', () => {
    const xp = computeMatchXp({ ...base, castles: 500 });
    expect(xp.breakdown.find((l) => l.label === 'Castles washed')?.xp).toBe(CONFIG.XP.CASTLE_CAP);
  });

  it('uses the placement table in 4p and gives last place the consolation entry', () => {
    const placementXp = (placement: number, playerCount: number) =>
      computeMatchXp({ ...base, placement, playerCount }).breakdown.find((l) => l.label === 'Placement')?.xp;
    expect([1, 2, 3, 4].map((p) => placementXp(p, 4))).toEqual([100, 60, 35, 20]);
    expect([1, 2].map((p) => placementXp(p, 2))).toEqual([100, 20]);
    expect([1, 2, 3].map((p) => placementXp(p, 3))).toEqual([100, 60, 20]);
  });

  it('omits empty optional lines but always shows participation and placement', () => {
    const xp = computeMatchXp({ ...base, placement: 4, roundsWon: 0, soaks: 0, castles: 0 });
    expect(xp.breakdown.map((l) => l.label)).toEqual(['Participation', 'Placement']);
    expect(xp.earned).toBe(60);
  });

  it('scales every line by the practice multiplier and keeps the sum invariant', () => {
    const xp = computeMatchXp({ ...base, practice: true });
    // 20 + 50 + round(22.5)=23 + 24 + 10
    expect(xp.earned).toBe(127);
    expect(sum(xp.breakdown)).toBe(xp.earned);
  });

  it('gives forfeiting players nothing', () => {
    const xp = computeMatchXp({ ...base, forfeited: true });
    expect(xp.earned).toBe(0);
    expect(sum(xp.breakdown)).toBe(0);
  });

  it('treats negative stat counts as zero', () => {
    const xp = computeMatchXp({ ...base, placement: 2, roundsWon: -3, soaks: -1, castles: -5 });
    expect(xp.earned).toBe(100);
  });
});

describe('unlocksBetween', () => {
  it('returns items whose unlock level is in (before, after]', () => {
    expect(unlocksBetween(1, 3)).toEqual(['otter', 'bucket']);
    expect(unlocksBetween(4, 5)).toEqual(['penguin']);
    expect(unlocksBetween(12, 13)).toEqual(['crown']);
  });

  it('returns nothing without a level-up', () => {
    expect(unlocksBetween(5, 5)).toEqual([]);
    expect(unlocksBetween(6, 5)).toEqual([]);
    expect(unlocksBetween(5, 6)).toEqual([]);
  });

  it('unlocks every non-starter item by level 20', () => {
    expect(unlocksBetween(1, 20).sort()).toEqual(
      ['otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara', 'bucket', 'snorkel', 'bandana', 'propeller', 'crown'].sort(),
    );
  });
});
