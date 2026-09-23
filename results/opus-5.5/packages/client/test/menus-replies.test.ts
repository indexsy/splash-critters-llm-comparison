// Dialog request replies: which pending request a server error belongs to, that errors nobody owns
// are still shown, and that success needs a change the request caused (not a leftover state).
import type { ErrorCode, LobbyState, MatchConfig } from '@splash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enteredNewRoom, receivedLobbyOf, startedPractice } from '../src/screens/parts/replyChecks';
import { awaitServerReply } from '../src/screens/parts/serverReply';
import { store, type AppState } from '../src/store';

const appMock = vi.hoisted(() => ({ claims: 0, toasts: [] as string[] }));

vi.mock('../src/app', () => ({
  claimServerErrors: () => {
    appMock.claims += 1;
    let released = false;
    return () => {
      if (!released) appMock.claims -= 1;
      released = true;
    };
  },
}));

vi.mock('../src/ui', () => ({ toast: (msg: string) => appMock.toasts.push(msg) }));

const lobbyOf = (code: string): LobbyState => ({ code, name: 'Room', phase: 'lobby' }) as LobbyState;
const matchOf = (matchId: string): MatchConfig => ({ matchId }) as MatchConfig;

/** What app.ts does with a server `error` message. */
function serverError(code: ErrorCode, msg = `${code} happened`): void {
  store.update({ lastError: { code, msg, at: Date.now() } });
}

function state(over: Partial<AppState>): AppState {
  return { ...store.get(), lobby: null, match: null, ...over };
}

let cancels: (() => void)[] = [];

function pendingRequest(errors: ErrorCode[], succeeded?: (n: Readonly<AppState>, p: Readonly<AppState>) => boolean) {
  const outcome = { errors: [] as string[], succeeded: 0 };
  cancels.push(
    awaitServerReply({
      errors,
      succeeded,
      onSuccess: () => (outcome.succeeded += 1),
      onError: (err) => outcome.errors.push(err.code),
    }),
  );
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  store.update({ lobby: null, match: null, lastError: null });
  appMock.toasts.length = 0;
});

afterEach(() => {
  for (const cancel of cancels) cancel();
  cancels = [];
  vi.useRealTimers();
  expect(appMock.claims).toBe(0);
});

describe('routing server errors to pending requests', () => {
  it('hands an owned error to its request, inline, and releases the claim', () => {
    const join = pendingRequest(['room_full']);
    expect(appMock.claims).toBe(1);
    serverError('room_full');
    expect(join.errors).toEqual(['room_full']);
    expect(appMock.toasts).toEqual([]);
    expect(appMock.claims).toBe(0);
  });

  it('owns the refusals any request can get', () => {
    const join = pendingRequest(['room_full']);
    serverError('rate_limited');
    expect(join.errors).toEqual(['rate_limited']);
  });

  it('toasts an error nobody owns and keeps the request waiting for its own answer', () => {
    const create = pendingRequest(['already_in_room']);
    serverError('locked_item', 'That item is locked.');
    expect(appMock.toasts).toEqual(['That item is locked.']);
    expect(create.errors).toEqual([]);
    expect(appMock.claims).toBe(1);
    serverError('already_in_room');
    expect(create.errors).toEqual(['already_in_room']);
    expect(appMock.toasts).toHaveLength(1);
  });

  it('toasts a foreign error once however many requests are pending', () => {
    pendingRequest(['room_full']);
    pendingRequest(['nickname_taken']);
    serverError('not_host');
    expect(appMock.toasts).toEqual(['not_host happened']);
  });

  it('gives a code two requests share to the oldest first (the server answers in order)', () => {
    const first = pendingRequest(['already_in_room']);
    const second = pendingRequest(['already_in_room']);
    serverError('already_in_room');
    expect([first.errors, second.errors]).toEqual([['already_in_room'], []]);
    serverError('already_in_room');
    expect(second.errors).toEqual(['already_in_room']);
    expect(appMock.toasts).toEqual([]);
  });

  it('gives an error to the request that owns it even when an older one is pending', () => {
    const create = pendingRequest(['already_in_room']);
    const nick = pendingRequest(['nickname_taken']);
    serverError('nickname_taken');
    expect(nick.errors).toEqual(['nickname_taken']);
    expect(create.errors).toEqual([]);
  });

  it('completes on its success transition and then leaves later errors to the app', () => {
    const join = pendingRequest(['room_full'], receivedLobbyOf('QWE789'));
    store.update({ lobby: lobbyOf('QWE789') });
    expect(join.succeeded).toBe(1);
    expect(appMock.claims).toBe(0);
    serverError('room_full');
    expect(join.errors).toEqual([]);
    expect(appMock.toasts).toEqual([]);
  });

  it('fails with a timeout when the server stays silent', () => {
    const create = pendingRequest(['already_in_room']);
    vi.advanceTimersByTime(8000);
    expect(create.errors).toEqual(['server_error']);
    expect(appMock.claims).toBe(0);
  });

  it('cancelling (the dialog closed) settles quietly', () => {
    const create = pendingRequest(['already_in_room']);
    cancels.pop()?.();
    serverError('already_in_room');
    vi.advanceTimersByTime(8000);
    expect(create).toEqual({ errors: [], succeeded: 0 });
    expect(appMock.claims).toBe(0);
  });
});

describe('request success checks', () => {
  it('create_room: a lobby for a new room, not an update of the room we sit in', () => {
    expect(enteredNewRoom(state({ lobby: lobbyOf('NEW234') }), state({}))).toBe(true);
    expect(enteredNewRoom(state({ lobby: lobbyOf('OLD234') }), state({ lobby: lobbyOf('OLD234') }))).toBe(false);
    expect(enteredNewRoom(state({ lobby: lobbyOf('NEW234') }), state({ lobby: lobbyOf('OLD234') }))).toBe(true);
    expect(enteredNewRoom(state({}), state({}))).toBe(false);
  });

  it('join_room: only the lobby of the requested code counts', () => {
    const joined = receivedLobbyOf('QWE789');
    expect(joined(state({ lobby: lobbyOf('QWE789') }), state({}))).toBe(true);
    expect(joined(state({ lobby: lobbyOf('ABC234') }), state({}))).toBe(false);
    // Re-joining the room you already sit in: the server re-sends its lobby.
    expect(joined(state({ lobby: lobbyOf('QWE789') }), state({ lobby: lobbyOf('QWE789') }))).toBe(true);
    const same = state({ lobby: lobbyOf('QWE789') });
    expect(joined(same, same)).toBe(false);
  });

  it('practice: a match left over from an earlier game is not success', () => {
    const old = matchOf('old');
    // A profile push after an earlier practice match: match is still set but unchanged.
    expect(startedPractice(state({ match: old }), state({ match: old }))).toBe(false);
    expect(startedPractice(state({ match: matchOf('new') }), state({ match: old }))).toBe(true);
    expect(startedPractice(state({ lobby: lobbyOf('PRA234'), match: old }), state({ match: old }))).toBe(true);
  });
});
