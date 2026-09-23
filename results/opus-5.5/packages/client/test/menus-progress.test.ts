// XP bar segments across level-ups, next-unlock lookup, spatial arrow navigation and REST
// payload validation for the leaderboard / profile screens.
import { levelFromXp, xpForLevel } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { parseLeaderboard, parsePublicProfile } from '../src/screens/parts/apiParse';
import { nextUnlock, xpSegments } from '../src/screens/parts/progress';
import { arrowDir, pickNeighbor, type Box } from '../src/screens/parts/spatial';

describe('xpSegments', () => {
  it('fills part of one level without levelling up', () => {
    expect(xpSegments(10, 60)).toEqual([{ level: 1, from: 10, to: 60, max: xpForLevel(1), levelsUp: false }]);
  });

  it('splits a gain across two level-ups and ends on the new level', () => {
    const l1 = xpForLevel(1);
    const l2 = xpForLevel(2);
    const segs = xpSegments(100, l1 + l2 + 25);
    expect(segs).toEqual([
      { level: 1, from: 100, to: l1, max: l1, levelsUp: true },
      { level: 2, from: 0, to: l2, max: l2, levelsUp: true },
      { level: 3, from: 0, to: 25, max: xpForLevel(3), levelsUp: false },
    ]);
    const end = levelFromXp(l1 + l2 + 25);
    expect(segs[segs.length - 1].level).toBe(end.level);
    expect(segs[segs.length - 1].to).toBe(end.xpIntoLevel);
  });

  it('adds an empty segment when the gain lands exactly on a level boundary', () => {
    const segs = xpSegments(0, xpForLevel(1));
    expect(segs).toHaveLength(2);
    expect(segs[1]).toEqual({ level: 2, from: 0, to: 0, max: xpForLevel(2), levelsUp: false });
  });

  it('treats no gain (or a bogus loss) as a single still segment', () => {
    expect(xpSegments(50, 50)).toHaveLength(1);
    expect(xpSegments(50, 10)).toEqual([{ level: 1, from: 50, to: 50, max: xpForLevel(1), levelsUp: false }]);
  });

  it('sums to the total gain', () => {
    const segs = xpSegments(333, 2345);
    expect(segs.reduce((sum, s) => sum + (s.to - s.from), 0)).toBe(2345 - 333);
  });
});

describe('nextUnlock', () => {
  it('names the closest upcoming cosmetic', () => {
    expect(nextUnlock(1)).toMatchObject({ kind: 'hat', id: 'bucket', level: 2 });
    expect(nextUnlock(2)).toMatchObject({ kind: 'animal', id: 'otter', level: 3 });
    expect(nextUnlock(19)).toMatchObject({ kind: 'animal', id: 'capybara', level: 20 });
    expect(nextUnlock(20)).toBeNull();
  });
});

describe('spatial navigation', () => {
  const box = (left: number, top: number, w = 40, h = 10): Box => ({ left, top, right: left + w, bottom: top + h });
  // Two columns: left buttons at x=0, right buttons at x=60.
  const items = [box(0, 0), box(0, 20), box(0, 40), box(60, 0), box(60, 20)];

  it('keeps vertical moves inside the current column', () => {
    expect(pickNeighbor(items[0], items, 'down')).toBe(1);
    expect(pickNeighbor(items[1], items, 'down')).toBe(2);
    expect(pickNeighbor(items[3], items, 'down')).toBe(4);
    expect(pickNeighbor(items[2], items, 'down')).toBe(-1);
  });

  it('crosses to the neighbouring column on the same row', () => {
    expect(pickNeighbor(items[1], items, 'right')).toBe(4);
    expect(pickNeighbor(items[4], items, 'left')).toBe(1);
    expect(pickNeighbor(items[0], items, 'left')).toBe(-1);
  });

  it('prefers a slightly offset button in the same column over a far one', () => {
    const wide = box(0, 60, 100, 10);
    expect(pickNeighbor(items[2], [...items, wide], 'down')).toBe(items.length);
  });

  it('lands on the first button of a row when leaving a wide control', () => {
    const toggle = box(0, 0, 150, 10);
    const buttons = [box(10, 20, 40, 10), box(60, 20, 60, 10)];
    expect(pickNeighbor(toggle, buttons, 'down')).toBe(0);
  });

  it('maps arrow key codes', () => {
    expect(arrowDir('ArrowUp')).toBe('up');
    expect(arrowDir('KeyW')).toBeNull();
  });
});

describe('REST payload validation', () => {
  const entry = { rank: 1, playerId: 'p1', nickname: 'Ted', tag: '0001', rating: 1800, tier: 'tsunami', games: 10, wins: 7, winrate: 0.7, animal: 'duck' };

  it('accepts bare arrays and { entries } wrappers, dropping malformed rows', () => {
    expect(parseLeaderboard([entry])).toHaveLength(1);
    expect(parseLeaderboard({ mode: 'duel', entries: [entry, { nope: true }] })).toHaveLength(1);
    expect(parseLeaderboard({ error: 'x' })).toBeNull();
  });

  it('fills a missing win rate from wins / games', () => {
    const [row] = parseLeaderboard([{ ...entry, winrate: undefined }]) ?? [];
    expect(row.winrate).toBeCloseTo(0.7);
  });

  it('validates public profiles', () => {
    const rating = { mode: 'duel', rating: 1000, games: 0, wins: 0, peak: 1000, tier: 'pond' };
    const profile = { id: 'p1', nickname: 'Ted', tag: '0001', level: 3, xp: 400, animal: 'duck', hat: 'none', unlocks: [], ratings: { duel: rating, ffa: { ...rating, mode: 'ffa' } }, recentMatches: [{ matchId: 'm', mode: 'duel', placement: 1 }, { bad: 1 }], createdAt: 0 };
    expect(parsePublicProfile(profile)?.recentMatches).toHaveLength(1);
    expect(parsePublicProfile({ profile })?.id).toBe('p1');
    expect(parsePublicProfile({ id: 'x' })).toBeNull();
  });
});
