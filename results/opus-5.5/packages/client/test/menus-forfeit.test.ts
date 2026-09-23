// Ranked forfeit feedback: the leaver lands on the menu with no results screen, so a toast says
// what the forfeit cost as soon as the server settles the match (at once for a Duel, later for
// an FFA that plays on), and never interrupts another match the player has started since.
import type { MatchConfig, Mode, Profile, RatingInfo } from '@splash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_WAIT_MS, WATCH_LIMIT_MS, forfeitPendingText, forfeitSettledText, ratingChangeText, watchForfeit } from '../src/screens/parts/forfeitNotice';
import { store } from '../src/store';

const toasts = vi.hoisted(() => [] as { msg: string; kind: string }[]);
vi.mock('../src/ui', () => ({ toast: (msg: string, kind = 'info') => toasts.push({ msg, kind }) }));

function rating(mode: Mode, rating: number, games: number, wins: number): RatingInfo {
  return { mode, rating, games, wins, peak: Math.max(1000, rating), tier: 'pond' } as RatingInfo;
}

function profile(duel: RatingInfo, ffa = rating('ffa', 1000, 0, 0)): Profile {
  return { id: 'p-1', nickname: 'Kicker', tag: '0042', ratings: { duel, ffa } } as Profile;
}

const duelMatch: Pick<MatchConfig, 'matchId' | 'mode'> = { matchId: 'm-1', mode: 'duel' };
const ffaMatch: Pick<MatchConfig, 'matchId' | 'mode'> = { matchId: 'm-2', mode: 'ffa' };

beforeEach(() => {
  vi.useFakeTimers();
  toasts.length = 0;
  store.update({ profile: profile(rating('duel', 1000, 4, 2)), match: null, matchEnd: null });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('forfeit texts', () => {
  it('spell the rating change without em dashes', () => {
    expect(ratingChangeText('duel', 1000, 968)).toBe('Duel rating 1000 to 968 (-32)');
    expect(ratingChangeText('ffa', 990, 1003)).toBe('Free-for-All rating 990 to 1003 (+13)');
    expect(forfeitPendingText('ffa')).toBe('Match forfeited. Your Free-for-All rating changes when the match ends.');
    const before = rating('duel', 1000, 4, 2);
    expect(forfeitSettledText('duel', before, rating('duel', 968, 5, 2), false)).toBe('Match forfeited. Duel rating 1000 to 968 (-32)');
    expect(forfeitSettledText('duel', before, rating('duel', 968, 5, 2), true)).toBe('Your forfeited match is over. Duel rating 1000 to 968 (-32)');
    expect(forfeitSettledText('duel', before, rating('duel', 1032, 5, 3), false)).toBe('Match won: everyone else left first. Duel rating 1000 to 1032 (+32)');
  });
});

describe('watchForfeit', () => {
  it('a Duel forfeit settles at once: one toast with the rating change', () => {
    watchForfeit(duelMatch);
    store.update({ profile: profile(rating('duel', 968, 5, 2)) });
    vi.advanceTimersByTime(SETTLE_WAIT_MS * 2);
    expect(toasts).toEqual([{ msg: 'Match forfeited. Duel rating 1000 to 968 (-32)', kind: 'warn' }]);
  });

  it('an FFA that plays on: "forfeited" now, the rating change when the match ends', () => {
    store.update({ profile: profile(rating('duel', 1000, 4, 2), rating('ffa', 1000, 1, 0)) });
    watchForfeit(ffaMatch);
    vi.advanceTimersByTime(SETTLE_WAIT_MS);
    expect(toasts.map((t) => t.msg)).toEqual([forfeitPendingText('ffa')]);
    // Unrelated profile updates (a nickname change, the other mode) are not the settlement.
    store.update({ profile: { ...profile(rating('duel', 1010, 5, 3), rating('ffa', 1000, 1, 0)), nickname: 'Other' } });
    expect(toasts).toHaveLength(1);
    store.update({ profile: profile(rating('duel', 1010, 5, 3), rating('ffa', 980, 2, 0)) });
    expect(toasts[1]).toEqual({ msg: 'Your forfeited match is over. Free-for-All rating 1000 to 980 (-20)', kind: 'info' });
  });

  it('stays quiet when the late result lands during another live match', () => {
    store.update({ profile: profile(rating('duel', 1000, 4, 2), rating('ffa', 1000, 1, 0)) });
    watchForfeit(ffaMatch);
    vi.advanceTimersByTime(SETTLE_WAIT_MS);
    store.update({ match: { matchId: 'm-3', mode: 'duel' } as MatchConfig, matchEnd: null });
    store.update({ profile: profile(rating('duel', 1000, 4, 2), rating('ffa', 980, 2, 0)) });
    expect(toasts.map((t) => t.msg)).toEqual([forfeitPendingText('ffa')]);
  });

  it('gives up after the watch limit and is replaced by a newer forfeit', () => {
    watchForfeit(ffaMatch);
    watchForfeit(duelMatch);
    store.update({ profile: profile(rating('duel', 968, 5, 2), rating('ffa', 990, 1, 0)) });
    expect(toasts.map((t) => t.msg)).toEqual(['Match forfeited. Duel rating 1000 to 968 (-32)']);
    watchForfeit(duelMatch);
    vi.advanceTimersByTime(WATCH_LIMIT_MS + SETTLE_WAIT_MS);
    const shown = toasts.length;
    store.update({ profile: profile(rating('duel', 940, 6, 2)) });
    expect(toasts).toHaveLength(shown);
  });
});
