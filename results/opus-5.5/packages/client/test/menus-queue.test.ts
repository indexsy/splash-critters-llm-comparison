// Ranked queue rules (Play Ranked from the menu, the queue screen following the server) and
// animation loops that stop once they settle.
import type { LobbyState, Profile } from '@splash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followQueue, rankedEntry, searchingMode } from '../src/screens/parts/queueRules';
import { Scope } from '../src/screens/parts/scope';
import type { AppState, MatchFoundInfo, QueueInfo } from '../src/store';

const profile = (hasNickname = true) => ({ nickname: 'Splash', tag: '0001', hasNickname }) as Profile;
const queued = (mode: 'duel' | 'ffa'): QueueInfo => ({ mode, elapsedMs: 0, searchRange: 100, eta: -1, inQueue: 1 });
const found = (mode: 'duel' | 'ffa'): MatchFoundInfo => ({ mode, roomCode: 'RNK234', players: [] });
const room = { code: 'ABC234' } as LobbyState;

function state(over: Partial<AppState> = {}): AppState {
  return {
    connected: true,
    profile: profile(),
    lobby: null,
    roomList: [],
    queue: null,
    matchFound: null,
    match: null,
    matchEnd: null,
    tutorialStep: null,
    lastError: null,
    ...over,
  };
}

describe('Play Ranked from the menu', () => {
  it('queues when nothing stands in the way', () => {
    expect(rankedEntry(state(), 'duel')).toEqual({ action: 'join' });
  });

  it('waits for the connection before anything else', () => {
    expect(rankedEntry(state({ profile: null }), 'duel')).toEqual({ action: 'wait_connect' });
  });

  it('shows the running search instead of starting a second one (either mode)', () => {
    expect(rankedEntry(state({ queue: queued('duel') }), 'ffa')).toEqual({ action: 'view_queue', mode: 'duel' });
    expect(rankedEntry(state({ queue: queued('duel') }), 'duel')).toEqual({ action: 'view_queue', mode: 'duel' });
    expect(rankedEntry(state({ matchFound: found('ffa') }), 'duel')).toEqual({ action: 'view_queue', mode: 'ffa' });
  });

  it('asks a seated player to leave their room first (the server refuses otherwise)', () => {
    expect(rankedEntry(state({ lobby: room }), 'duel')).toEqual({ action: 'leave_room_first', code: 'ABC234' });
    expect(rankedEntry(state({ lobby: room, profile: profile(false) }), 'duel')).toEqual({ action: 'leave_room_first', code: 'ABC234' });
  });

  it('opens the nickname gate for guest names', () => {
    expect(rankedEntry(state({ profile: profile(false) }), 'ffa')).toEqual({ action: 'pick_nickname' });
  });

  it('knows which mode is being searched', () => {
    expect(searchingMode(state())).toBeNull();
    expect(searchingMode(state({ queue: queued('ffa') }))).toBe('ffa');
    expect(searchingMode(state({ queue: queued('ffa'), matchFound: found('ffa') }))).toBe('ffa');
  });
});

describe('queue screen follows the server', () => {
  const err = (code: 'already_queued' | 'already_in_room' | 'rate_limited') => ({ code, msg: code, at: 1 });

  it('stays while its own search runs, even through an unrelated error', () => {
    expect(followQueue(state({ queue: queued('duel') }), state(), 'duel')).toEqual({ to: 'stay' });
    expect(followQueue(state({ queue: queued('duel'), lastError: err('rate_limited') }), state({ queue: queued('duel') }), 'duel')).toEqual({ to: 'stay' });
  });

  it('moves to the mode the server actually holds the player in', () => {
    expect(followQueue(state({ queue: queued('duel') }), state(), 'ffa')).toEqual({ to: 'queue', mode: 'duel' });
  });

  it('already_queued here means the other queue holds the player', () => {
    expect(followQueue(state({ lastError: err('already_queued') }), state(), 'ffa')).toEqual({ to: 'queue', mode: 'duel' });
    expect(followQueue(state({ lastError: err('already_queued') }), state(), 'duel')).toEqual({ to: 'queue', mode: 'ffa' });
  });

  it('returns to the menu when the search is dropped or refused', () => {
    expect(followQueue(state(), state({ queue: queued('duel') }), 'duel')).toEqual({ to: 'menu' });
    expect(followQueue(state({ lastError: err('already_in_room') }), state(), 'duel')).toEqual({ to: 'menu' });
  });

  it('ignores store changes that say nothing about the queue', () => {
    const same = state({ lastError: err('already_in_room') });
    expect(followQueue(same, same, 'duel')).toEqual({ to: 'stay' });
    expect(followQueue(state({ roomList: [] }), state(), 'duel')).toEqual({ to: 'stay' });
  });
});

describe('Scope.loop', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeFrames() {
    let queue = new Map<number, (now: number) => void>();
    let next = 1;
    vi.stubGlobal('requestAnimationFrame', (fn: (now: number) => void) => {
      queue.set(next, fn);
      return next++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
    return {
      pending: () => queue.size,
      run(now: number) {
        const due = queue;
        queue = new Map();
        for (const fn of due.values()) fn(now);
      },
    };
  }

  it('stops asking for frames once the callback returns false', () => {
    const frames = fakeFrames();
    const scope = new Scope();
    const seen: number[] = [];
    scope.loop((now) => {
      seen.push(now);
      if (now >= 3) return false;
    });
    for (let t = 1; t <= 5; t++) frames.run(t);
    expect(seen).toEqual([1, 2, 3]);
    expect(frames.pending()).toBe(0);
    scope.dispose();
  });

  it('keeps running until disposed when the callback never settles', () => {
    const frames = fakeFrames();
    const scope = new Scope();
    let calls = 0;
    scope.loop(() => {
      calls += 1;
    });
    for (let t = 1; t <= 4; t++) frames.run(t);
    expect(calls).toBe(4);
    expect(frames.pending()).toBe(1);
    scope.dispose();
    expect(frames.pending()).toBe(0);
  });
});
