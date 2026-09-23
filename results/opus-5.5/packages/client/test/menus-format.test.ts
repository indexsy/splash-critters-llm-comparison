// Menu display formatting: clocks, search range + ETA text, ordinals, signs, percentages,
// relative times, countdowns, room codes and the local nickname check.
import { CONFIG } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import {
  etaText,
  formatClockMs,
  isRoomCode,
  modeSize,
  nameTag,
  nicknameProblem,
  normaliseRoomCode,
  ordinal,
  percent,
  rangeProgress,
  rangeText,
  rematchNeeded,
  secondsLeft,
  signed,
  themeLabel,
  timeAgo,
} from '../src/screens/parts/format';

describe('clock and queue text', () => {
  it('formats elapsed milliseconds as mm:ss', () => {
    expect(formatClockMs(0)).toBe('00:00');
    expect(formatClockMs(7_999)).toBe('00:07');
    expect(formatClockMs(65_000)).toBe('01:05');
    expect(formatClockMs(3_600_000 + 2_000)).toBe('60:02');
    expect(formatClockMs(-500)).toBe('00:00');
    expect(formatClockMs(Number.NaN)).toBe('00:00');
  });

  it('shows the search window and how far it has widened', () => {
    expect(rangeText(150)).toBe('±150');
    expect(rangeText(-3)).toBe('±0');
    expect(rangeProgress(CONFIG.MM_BASE_RANGE)).toBe(0);
    expect(rangeProgress(CONFIG.MM_MAX_RANGE)).toBe(1);
    expect(rangeProgress((CONFIG.MM_BASE_RANGE + CONFIG.MM_MAX_RANGE) / 2)).toBeCloseTo(0.5);
    expect(rangeProgress(10_000)).toBe(1);
  });

  it('writes the ETA in seconds or minutes and hides unknown values', () => {
    expect(etaText(8)).toBe('~8s');
    expect(etaText(59)).toBe('~59s');
    expect(etaText(59.6)).toBe('~1m 00s');
    expect(etaText(65)).toBe('~1m 05s');
    expect(etaText(0)).toBe('--');
    expect(etaText(-1)).toBe('--');
    expect(etaText(Number.POSITIVE_INFINITY)).toBe('--');
  });
});

describe('numbers and names', () => {
  it('builds English ordinals including the teens', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
    expect([11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });

  it('signs rating changes', () => {
    expect(signed(12)).toBe('+12');
    expect(signed(-8)).toBe('-8');
    expect(signed(0)).toBe('+0');
    expect(signed(4.6)).toBe('+5');
  });

  it('rounds win rates to whole percentages', () => {
    expect(percent(0.567)).toBe('57%');
    expect(percent(1.2)).toBe('100%');
    expect(percent(Number.NaN)).toBe('0%');
  });

  it('joins nickname and tag', () => {
    expect(nameTag('SoggyOtter', '4821')).toBe('SoggyOtter#4821');
    expect(nameTag('Bot Bubbles', '')).toBe('Bot Bubbles');
  });

  it('labels themes and modes', () => {
    expect(themeLabel('pool')).toBe('Pool Party');
    expect(themeLabel('random')).toBe('Random');
    expect(modeSize('duel')).toBe('2P');
    expect(modeSize('ffa')).toBe('4P');
  });
});

describe('time', () => {
  const now = 1_000_000_000;
  it('describes how long ago a match ended', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3d ago');
    expect(timeAgo(now + 5_000, now)).toBe('just now');
  });

  it('counts whole seconds down to a deadline', () => {
    expect(secondsLeft(now + 24_001, now)).toBe(25);
    expect(secondsLeft(now + 24_000, now)).toBe(24);
    expect(secondsLeft(now - 1, now)).toBe(0);
    expect(secondsLeft(0, now)).toBe(0);
  });
});

describe('rematch majority', () => {
  it('needs a strict majority of the connected humans', () => {
    expect([0, 1, 2, 3, 4].map(rematchNeeded)).toEqual([1, 1, 2, 2, 3]);
  });
});

describe('room codes and nicknames', () => {
  it('normalises typed room codes to the server alphabet', () => {
    expect(normaliseRoomCode('abc234')).toBe('ABC234');
    expect(normaliseRoomCode('a-b c1o0i9xyz')).toBe('ABC9XY');
    expect(isRoomCode('ABC234')).toBe(true);
    expect(isRoomCode('ABC23')).toBe(false);
    expect(isRoomCode('ABC10O')).toBe(false);
  });

  it('checks nickname length like the server', () => {
    expect(nicknameProblem('ab')).toMatch(/at least/i);
    expect(nicknameProblem('   abc   ')).toBeNull();
    expect(nicknameProblem('x'.repeat(CONFIG.NICK_MAX))).toBeNull();
    expect(nicknameProblem('x'.repeat(CONFIG.NICK_MAX + 1))).toMatch(/at most/i);
  });
});
