// Regressions from the server-core review: forfeiters never get a spawn (no ghost critter),
// leaving after the result is settled keeps the real result, bot-filled seats reopen in the
// lobby, and a half-open socket's grace counts from when the player was last heard.
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, Dir, levelFromXp, type CreateRoomOpts, type MsgOf, type S2C, type S2CType } from '@splash/shared';
import { loginOrCreate } from '../src/accounts';
import { getRating, getRecentMatches, openDb, type Db } from '../src/db';
import type { BotFactory, MemberInfo } from '../src/match/types';
import type { Outbox } from '../src/net/outbox';
import { RoomManager } from '../src/rooms';
import type { Room } from '../src/rooms/room';

class FakeOutbox implements Outbox {
  readonly sent = new Map<string, S2C[]>();
  send(playerId: string, msg: S2C): void {
    this.sent.set(playerId, [...(this.sent.get(playerId) ?? []), msg]);
  }
  rtt(): number {
    return 30;
  }
  ofType<T extends S2CType>(playerId: string, type: T): MsgOf<S2C, T>[] {
    return (this.sent.get(playerId) ?? []).filter((m): m is MsgOf<S2C, T> => m.type === type);
  }
  last<T extends S2CType>(playerId: string, type: T): MsgOf<S2C, T> | undefined {
    return this.ofType(playerId, type).at(-1);
  }
}

/** Bots never act, so rounds only end when a test soaks someone. */
const idleBots: BotFactory = (slot, difficulty) => ({ slot, difficulty, nextInput: () => ({ seq: 0, dir: Dir.None, balloon: false }), reset: () => undefined });

const openDbs: Db[] = [];
afterEach(() => openDbs.splice(0).forEach((db) => db.close()));

function harness() {
  const db = openDb(':memory:');
  openDbs.push(db);
  const outbox = new FakeOutbox();
  const rooms = new RoomManager({ db, outbox, createBot: idleBots });
  let now = 7_000_000;
  const member = (name: string): MemberInfo => {
    const { player } = loginOrCreate(db);
    return { playerId: player.id, name, tag: player.tag, animal: player.animal, hat: player.hat, level: levelFromXp(player.xp).level, hasNickname: true };
  };
  const step = () => {
    now += CONFIG.TICK_MS;
    rooms.tick(now);
  };
  const until = (done: () => boolean) => {
    for (let guard = 0; !done(); guard++) {
      if (guard > 200_000) throw new Error('until: timed out');
      step();
    }
  };
  /** Soaks every listed slot of the live round so the sim ends it on the next tick. */
  const soak = (room: Room, slots: number[]) => {
    const state = room.runner!.state!;
    for (const slot of slots) {
      state.players[slot].alive = false;
      state.players[slot].soakedTick = state.tick;
    }
  };
  /** Plays rounds until `winner` has won `rounds` of them (the others soaked each round). */
  const winRounds = (room: Room, winner: number, rounds: number) => {
    for (let i = 0; i < rounds; i++) {
      until(() => room.runner!.phase === 'live');
      soak(room, room.runner!.state!.players.filter((p) => p.present && p.slot !== winner).map((p) => p.slot));
      until(() => room.runner!.phase === 'settling');
      if (i < rounds - 1) until(() => room.runner!.phase === 'between');
    }
  };
  return { db, outbox, rooms, member, step, until, soak, winRounds, get now() { return now; } };
}

const casual = (extra: Partial<CreateRoomOpts> = {}): CreateRoomOpts => ({ name: '', size: 2, isPublic: true, theme: 'beach', roundsToWin: 2, botFill: false, ...extra });

describe('forfeited players get no spawn (no ghost critter on the client)', () => {
  it('drops a mid-round FFA forfeiter from every later round_start, resync included', () => {
    const h = harness();
    const ms = ['A', 'B', 'C', 'D'].map(h.member);
    const room = h.rooms.createRankedMatch('ffa', ms, h.now);
    h.until(() => room.runner!.phase === 'live');
    h.rooms.leave(ms[3].playerId, h.now);
    h.soak(room, [1, 2]);
    h.until(() => h.outbox.ofType(ms[0].playerId, 'round_start').length === 2);
    const next = h.outbox.last(ms[0].playerId, 'round_start')!;
    expect(next.spawns.map((s) => s.slot)).toEqual([0, 1, 2]);
    h.rooms.disconnected(ms[1].playerId, h.now);
    h.rooms.reattach(ms[1].playerId, h.now);
    expect(h.outbox.last(ms[1].playerId, 'round_start')!.spawns.map((s) => s.slot)).toEqual([0, 1, 2]);
  });

  it('drops a player who forfeits during the match intro from round 1', () => {
    const h = harness();
    const ms = ['A', 'B', 'C', 'D'].map(h.member);
    const room = h.rooms.createRankedMatch('ffa', ms, h.now);
    h.rooms.leave(ms[2].playerId, h.now);
    h.until(() => room.runner!.phase === 'countdown');
    expect(h.outbox.last(ms[0].playerId, 'round_start')!.spawns.map((s) => s.slot)).toEqual([0, 1, 3]);
  });
});

describe('leaving after the match result is settled', () => {
  it('keeps a ranked duel winner who leaves during the final pause as the winner', () => {
    const h = harness();
    const [win, lose] = [h.member('Win'), h.member('Lose')];
    const room = h.rooms.createRankedMatch('duel', [win, lose], h.now);
    h.winRounds(room, 0, CONFIG.ROUNDS_TO_WIN_DEFAULT);
    h.until(() => room.runner!.phase === 'between');
    expect(room.runner!.outcomeDecided).toBe(true);
    h.rooms.leave(win.playerId, h.now);
    expect(h.outbox.last(win.playerId, 'left_room')!.reason).toBe('left');
    expect(h.outbox.last(lose.playerId, 'player_status')).toMatchObject({ slot: 0, connected: false, forfeited: false, replacedByBot: false });
    h.until(() => room.runner!.phase === 'ended');
    const end = h.outbox.last(lose.playerId, 'match_end')!;
    expect(end.placements.map((p) => [p.slot, p.placement, p.forfeited])).toEqual([
      [0, 1, false],
      [1, 2, false],
    ]);
    expect(end.ratingDeltas!.find((d) => d.slot === 0)!.delta).toBeGreaterThan(0);
    expect(getRating(h.db, win.playerId, 'duel')).toMatchObject({ games: 1, wins: 1 });
    expect(h.outbox.ofType(win.playerId, 'match_end')).toHaveLength(0);
    expect(h.outbox.ofType(win.playerId, 'profile')).toHaveLength(1);
    expect(h.outbox.last(lose.playerId, 'left_room')!.reason).toBe('match_over');
  });

  it('credits the deciding round when the winner leaves while it is still settling', () => {
    const h = harness();
    const [win, lose] = [h.member('Win'), h.member('Lose')];
    const room = h.rooms.createRankedMatch('duel', [win, lose], h.now);
    h.winRounds(room, 0, CONFIG.ROUNDS_TO_WIN_DEFAULT);
    expect(room.runner!.phase).toBe('settling');
    expect(room.runner!.outcomeDecided).toBe(true);
    h.rooms.leave(win.playerId, h.now);
    h.until(() => room.runner!.phase === 'ended');
    const end = room.runner!.result!;
    expect(end.placements[0]).toMatchObject({ slot: 0, placement: 1, roundsWon: CONFIG.ROUNDS_TO_WIN_DEFAULT, forfeited: false });
    expect(h.outbox.last(lose.playerId, 'round_end')!.scores).toEqual([CONFIG.ROUNDS_TO_WIN_DEFAULT, 0]);
  });

  it('still forfeits a leaver while the match is open (a non-deciding round settling)', () => {
    const h = harness();
    const [a, b] = [h.member('A'), h.member('B')];
    const room = h.rooms.createRankedMatch('duel', [a, b], h.now);
    h.winRounds(room, 0, 1);
    expect(room.runner!.outcomeDecided).toBe(false);
    h.rooms.leave(a.playerId, h.now);
    expect(room.runner!.result!.placements.map((p) => [p.slot, p.placement, p.forfeited, p.roundsWon])).toEqual([
      [1, 1, false, 0],
      [0, 2, true, 1],
    ]);
  });

  it('credits the settled round to its winner when a forfeit ends the match during the pause', () => {
    const h = harness();
    const ms = ['A', 'B', 'C', 'D'].map(h.member);
    const room = h.rooms.createRankedMatch('ffa', ms, h.now);
    h.winRounds(room, 2, 1);
    expect(room.runner!.outcomeDecided).toBe(false);
    h.rooms.leave(ms[3].playerId, h.now);
    h.rooms.leave(ms[2].playerId, h.now);
    h.rooms.leave(ms[1].playerId, h.now);
    const placements = room.runner!.result!.placements;
    expect(placements.map((p) => [p.slot, p.placement, p.forfeited, p.roundsWon])).toEqual([
      [0, 1, false, 0],
      [2, 2, true, 1],
      [1, 3, true, 0],
      [3, 3, true, 0],
    ]);
  });

  it('gives a casual winner who leaves during the final pause their XP instead of handing it to a bot', () => {
    const h = harness();
    const [host, guest] = [h.member('Host'), h.member('Guest')];
    const room = h.rooms.create(host, casual(), h.now);
    h.rooms.join(guest, room.code, h.now);
    h.rooms.setReady(guest.playerId, true, h.now);
    h.rooms.start(host.playerId, h.now);
    h.winRounds(room, 1, 2);
    h.rooms.leave(guest.playerId, h.now);
    expect(room.seats[1].kind).toBe('human');
    h.until(() => room.phase === 'results');
    const end = h.outbox.last(host.playerId, 'match_end')!;
    expect(end.placements[0]).toMatchObject({ slot: 1, playerId: guest.playerId, isBot: false, placement: 1 });
    expect(end.xp.find((x) => x.playerId === guest.playerId)!.earned).toBeGreaterThan(0);
    expect(getRecentMatches(h.db, guest.playerId, 5)[0]).toMatchObject({ placement: 1 });
    expect(room.seats[1].kind).toBe('open');
    expect(h.rooms.roomOf(guest.playerId)).toBeUndefined();
  });

  it('keeps practice XP for a winner who leaves during the final pause, then closes the room', () => {
    const h = harness();
    const solo = h.member('Solo');
    const room = h.rooms.create(solo, casual({ practice: true, practiceDifficulty: 'easy' }), h.now);
    h.winRounds(room, 0, 2);
    h.rooms.leave(solo.playerId, h.now);
    h.until(() => room.runner!.phase === 'ended');
    expect(h.rooms.get(room.code)).toBeUndefined();
    expect(getRecentMatches(h.db, solo.playerId, 5)[0]).toMatchObject({ placement: 1 });
    expect(h.outbox.ofType(solo.playerId, 'match_end')).toHaveLength(0);
  });
});

describe('bot-filled seats', () => {
  it('reopen when the room returns to the lobby, so the public room is joinable again', () => {
    const h = harness();
    const [a, b] = [h.member('A'), h.member('B')];
    const room = h.rooms.create(a, casual({ size: 4, botFill: true }), h.now);
    h.rooms.join(b, room.code, h.now);
    h.rooms.setReady(b.playerId, true, h.now);
    h.rooms.setSlot(a.playerId, { slot: 3, kind: 'bot', difficulty: 'hard' }, h.now);
    h.rooms.start(a.playerId, h.now);
    expect(room.seats.map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot']);
    h.winRounds(room, 0, 2);
    h.until(() => room.phase === 'results');
    h.until(() => room.phase === 'lobby');
    expect(room.seats.map((s) => s.kind)).toEqual(['human', 'human', 'open', 'bot']);
    expect(h.rooms.list()[0]).toMatchObject({ players: 3, joinable: true });
    h.rooms.join(h.member('C'), room.code, h.now);
    expect(room.seats[2].kind).toBe('human');
  });
});

describe('half-open disconnects', () => {
  it('counts the reconnect grace from when the player was last heard', () => {
    const h = harness();
    const [a, b] = [h.member('A'), h.member('B')];
    const room = h.rooms.create(a, casual(), h.now);
    h.rooms.join(b, room.code, h.now);
    h.rooms.setReady(b.playerId, true, h.now);
    h.rooms.start(a.playerId, h.now);
    h.until(() => room.runner!.phase === 'live');
    const lastHeard = h.now - 7000;
    h.rooms.disconnected(b.playerId, h.now, lastHeard);
    h.until(() => h.now >= lastHeard + CONFIG.RECONNECT_GRACE_MS + CONFIG.TICK_MS);
    expect(room.seats[1]).toMatchObject({ kind: 'bot', auto: true });
  });
});
