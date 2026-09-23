// Lobby start rules, rematch tallies, results headline / fun stat text and keybind conflicts.
import type { FunStat, LobbyState, SlotView } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { bindOwner, unboundActions } from '../src/screens/parts/keybinds';
import { isHost, mySlot, participantCount, rematchTally, startBlocker } from '../src/screens/parts/lobbyRules';
import { funStatValue, resultHeadline } from '../src/screens/parts/resultsText';
import type { Keybinds } from '../src/settings';

function slot(i: number, over: Partial<SlotView> = {}): SlotView {
  return { slot: i, kind: 'open', ready: false, connected: true, isHost: false, ...over };
}

function lobby(slots: SlotView[], over: Partial<LobbyState> = {}): LobbyState {
  return {
    code: 'ABC234',
    name: 'Room',
    mode: slots.length === 2 ? 'duel' : 'ffa',
    size: slots.length as 2 | 4,
    isPublic: true,
    practice: false,
    theme: 'beach',
    roundsToWin: 3,
    botFill: false,
    phase: 'lobby',
    slots,
    hostSlot: 0,
    yourSlot: 0,
    rematchVotes: [],
    rematchDeadline: 0,
    link: '/#/room/ABC234',
    ...over,
  };
}

const host = slot(0, { kind: 'human', name: 'Host', isHost: true });

describe('start rules', () => {
  it('needs at least two participants', () => {
    const solo = lobby([host, slot(1), slot(2), slot(3)]);
    expect(participantCount(solo)).toBe(1);
    expect(startBlocker(solo)).toMatch(/bot|player/i);
  });

  it('counts open slots as bots when bot fill is on', () => {
    const filled = lobby([host, slot(1), slot(2, { kind: 'closed' }), slot(3)], { botFill: true });
    expect(participantCount(filled)).toBe(3);
    expect(startBlocker(filled)).toBeNull();
  });

  it('waits for every non-host human to be ready', () => {
    const one = lobby([host, slot(1, { kind: 'human', name: 'Dan' }), slot(2, { kind: 'bot', ready: true }), slot(3)]);
    expect(startBlocker(one)).toBe('Waiting for Dan to ready up');
    const two = lobby([host, slot(1, { kind: 'human', name: 'Dan' }), slot(2, { kind: 'human', name: 'Eve' }), slot(3)]);
    expect(startBlocker(two)).toBe('Waiting for 2 players to ready up');
    const ready = lobby([host, slot(1, { kind: 'human', name: 'Dan', ready: true }), slot(2), slot(3)]);
    expect(startBlocker(ready)).toBeNull();
  });

  it('blocks outside the lobby phase', () => {
    expect(startBlocker(lobby([host, slot(1, { kind: 'bot' })], { phase: 'results' }))).not.toBeNull();
  });

  it('knows who is host and which slot is yours', () => {
    const l = lobby([host, slot(1, { kind: 'human', name: 'Dan' })], { yourSlot: 1 });
    expect(isHost(l)).toBe(false);
    expect(mySlot(l)?.name).toBe('Dan');
  });
});

describe('rematch tally', () => {
  it('counts votes against a majority of connected humans only', () => {
    const l = lobby(
      [host, slot(1, { kind: 'human' }), slot(2, { kind: 'human', connected: false }), slot(3, { kind: 'bot' })],
      { phase: 'results', rematchVotes: [1], yourSlot: 0 },
    );
    expect(rematchTally(l)).toEqual({ votes: 1, needed: 2, youVoted: false });
    expect(rematchTally({ ...l, rematchVotes: [0, 1] }).youVoted).toBe(true);
  });
});

describe('results text', () => {
  it('celebrates first place and names other finishes', () => {
    expect(resultHeadline(1, 'ffa')).toEqual({ text: 'Victory!', mood: 'victory' });
    expect(resultHeadline(2, 'duel')).toEqual({ text: 'Defeat', mood: 'defeat' });
    expect(resultHeadline(3, 'ffa')).toEqual({ text: '3rd place', mood: 'defeat' });
    expect(resultHeadline(null, 'ffa').mood).toBe('neutral');
  });

  it('formats fun stat values (survival time comes in whole seconds)', () => {
    const stat = (id: FunStat['id'], value: number): FunStat => ({ id, label: '', slot: 0, value });
    expect(funStatValue(stat('most_soaks', 1))).toBe('1 soak');
    expect(funStatValue(stat('most_soaks', 4))).toBe('4 soaks');
    expect(funStatValue(stat('castle_crusher', 23))).toBe('23 castles');
    expect(funStatValue(stat('longest_survivor', 104))).toBe('01:44');
    expect(funStatValue(stat('biggest_chain', 3))).toBe('x3 chain');
  });
});

describe('keybind conflicts', () => {
  const binds: Keybinds = {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD', 'ArrowRight'],
    balloon: ['Space'],
    emote1: [],
    emote2: ['Digit2'],
    emote3: ['Digit3'],
    emote4: ['Digit4'],
    mute: ['KeyM'],
  };

  it('finds the other action that owns a key', () => {
    expect(bindOwner(binds, 'KeyD', 'up')).toBe('right');
    expect(bindOwner(binds, 'KeyD', 'right')).toBeNull();
    expect(bindOwner(binds, 'KeyZ', 'up')).toBeNull();
  });

  it('lists actions left without any key', () => {
    expect(unboundActions(binds)).toEqual(['emote1']);
  });
});
