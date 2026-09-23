// Live-update rules for the menus: focus after a region rebuild, room browser rows while a join
// is pending, abandoning a room-link join, and fun stat values that fit their card.
import type { FunStat, RoomSummary } from '@splash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARK, refocusTarget, type RefocusCandidate } from '../src/screens/parts/refocus';
import { isRoomOpen, roomAction, sortRooms } from '../src/screens/parts/roomRules';
import { FUN_VALUE_MAX_CHARS, funStatValue } from '../src/screens/parts/resultsText';
import { abandonRoomJoin, isAbandonedJoin } from '../src/screens/parts/joinCancel';

const netMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    handlers,
    connected: true,
    sent: [] as unknown[],
    emit(type: string) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn();
    },
  };
});

vi.mock('../src/net', () => ({
  net: {
    send: (msg: unknown) => {
      if (!netMock.connected) return false;
      netMock.sent.push(msg);
      return true;
    },
    on: (type: string, fn: () => void) => {
      const set = netMock.handlers.get(type) ?? new Set();
      netMock.handlers.set(type, set);
      set.add(fn);
      return () => set.delete(fn);
    },
  },
}));

function ctl(key: string | undefined, over: Partial<RefocusCandidate> = {}): RefocusCandidate {
  return { key, disabled: false, preferred: false, ...over };
}

describe('refocus after a rebuild', () => {
  it('keeps focus on the control with the same key', () => {
    expect(refocusTarget([ctl('leave'), ctl('vote')], 'vote')).toBe(1);
  });

  it('parks the cursor when the same control is now disabled', () => {
    expect(refocusTarget([ctl('vote', { disabled: true }), ctl('leave')], 'vote')).toBe(PARK);
  });

  it('prefers the autofocus control over the first one when the key is gone', () => {
    // The rematch vote closed: LEAVE ROOM comes first in the bar, BACK TO LOBBY is the preferred one.
    const closed = [ctl('leave'), ctl('continue', { preferred: true })];
    expect(refocusTarget(closed, 'vote')).toBe(1);
  });

  it('skips a disabled preferred control and falls back to the first enabled one', () => {
    const lobby = [ctl('copy'), ctl('start', { preferred: true, disabled: true })];
    expect(refocusTarget(lobby, 'slot-3')).toBe(0);
  });

  it('parks when nothing can take focus', () => {
    expect(refocusTarget([], 'vote')).toBe(PARK);
    expect(refocusTarget([ctl(undefined, { disabled: true })], undefined)).toBe(PARK);
  });
});

function room(over: Partial<RoomSummary> = {}): RoomSummary {
  return { code: 'ABC234', name: 'Room', mode: 'duel', players: 1, maxPlayers: 2, theme: 'beach', host: 'Host#0001', inMatch: false, joinable: true, ...over };
}

describe('room browser rows', () => {
  it('shows JOIN, IN MATCH or FULL', () => {
    expect(roomAction(room(), null)).toBe('join');
    expect(roomAction(room({ inMatch: true, joinable: false }), null)).toBe('in_match');
    expect(roomAction(room({ players: 2 }), null)).toBe('full');
    expect(roomAction(room({ joinable: false }), null)).toBe('full');
  });

  it('keeps the pending join on its row across live updates, even once that join filled the room', () => {
    expect(roomAction(room(), 'ABC234')).toBe('pending');
    expect(roomAction(room({ players: 2, joinable: false }), 'ABC234')).toBe('pending');
    expect(roomAction(room({ code: 'QWE789' }), 'ABC234')).toBe('join');
  });

  it('sorts open rooms first, then running matches, then full ones', () => {
    const rooms = [room({ code: 'FULL22', players: 2 }), room({ code: 'MATCH2', inMatch: true }), room({ code: 'OPEN22' })];
    expect(sortRooms(rooms).map((r) => r.code)).toEqual(['OPEN22', 'MATCH2', 'FULL22']);
    expect(isRoomOpen(rooms[2])).toBe(true);
  });
});

describe('abandoning a room-link join', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    netMock.sent.length = 0;
    netMock.connected = true;
  });

  afterEach(() => {
    netMock.emit('left_room');
    vi.useRealTimers();
  });

  it('sends leave_room behind the join and treats the code as abandoned until left_room', () => {
    abandonRoomJoin('ABC234');
    expect(netMock.sent).toEqual([{ type: 'leave_room' }]);
    expect(isAbandonedJoin('ABC234')).toBe(true);
    expect(isAbandonedJoin('QWE789')).toBe(false);
    netMock.emit('left_room');
    expect(isAbandonedJoin('ABC234')).toBe(false);
  });

  it('forgets the code if left_room never arrives', () => {
    abandonRoomJoin('ABC234');
    vi.advanceTimersByTime(10_000);
    expect(isAbandonedJoin('ABC234')).toBe(false);
  });

  it('does nothing while offline (the app drops the join itself)', () => {
    netMock.connected = false;
    abandonRoomJoin('ABC234');
    expect(netMock.sent).toEqual([]);
    expect(isAbandonedJoin('ABC234')).toBe(false);
  });

  it('a newer abandon replaces the older one', () => {
    abandonRoomJoin('ABC234');
    abandonRoomJoin('QWE789');
    expect(isAbandonedJoin('ABC234')).toBe(false);
    expect(isAbandonedJoin('QWE789')).toBe(true);
    expect(netMock.handlers.get('left_room')?.size).toBe(1);
  });
});

describe('fun stat values fit their card', () => {
  const stat = (id: FunStat['id'], value: number): FunStat => ({ id, label: id, slot: 0, value });

  it('keeps the unit while it fits and drops it for huge counts', () => {
    expect(funStatValue(stat('castle_crusher', 999))).toBe('999 castles');
    expect(funStatValue(stat('castle_crusher', 1234))).toBe('1234');
    expect(funStatValue(stat('most_soaks', 1))).toBe('1 soak');
    expect(funStatValue(stat('biggest_chain', 12))).toBe('x12 chain');
    expect(funStatValue(stat('biggest_chain', 100000))).toBe('x100000');
  });

  it('never exceeds the card width for realistic values', () => {
    const values = [0, 1, 9, 99, 999, 1800, 12000];
    for (const id of ['most_soaks', 'castle_crusher', 'biggest_chain'] as const) {
      for (const v of values) expect(funStatValue(stat(id, v)).length).toBeLessThanOrEqual(FUN_VALUE_MAX_CHARS);
    }
    expect(funStatValue(stat('longest_survivor', 3599)).length).toBeLessThanOrEqual(FUN_VALUE_MAX_CHARS);
  });
});
