import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, Dir, levelFromXp, type CreateRoomOpts, type MsgOf, type S2C, type S2CType } from '@splash/shared';
import { loginOrCreate } from '../src/accounts';
import { openDb, type Db } from '../src/db';
import type { BotFactory, MemberInfo } from '../src/match/types';
import { ClientError } from '../src/net/errors';
import type { Outbox } from '../src/net/outbox';
import { RoomManager } from '../src/rooms';

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

class FakeOutbox implements Outbox {
  readonly sent = new Map<string, S2C[]>();
  send(playerId: string, msg: S2C): void {
    const list = this.sent.get(playerId) ?? [];
    list.push(msg);
    this.sent.set(playerId, list);
  }
  rtt(): number {
    return 30;
  }
  of(playerId: string): S2C[] {
    return this.sent.get(playerId) ?? [];
  }
  ofType<T extends S2CType>(playerId: string, type: T): MsgOf<S2C, T>[] {
    return this.of(playerId).filter((m): m is MsgOf<S2C, T> => m.type === type);
  }
  last<T extends S2CType>(playerId: string, type: T): MsgOf<S2C, T> | undefined {
    return this.ofType(playerId, type).at(-1);
  }
  clear(): void {
    this.sent.clear();
  }
}

/** Every bot seated in slot 1 drops a balloon on itself (rounds end fast); others idle. */
const selfSoakingSlot1: BotFactory = (slot, difficulty) => ({
  slot,
  difficulty,
  nextInput: () => ({ seq: 0, dir: Dir.None, balloon: slot === 1 }),
  reset: () => undefined,
});

const openDbs: Db[] = [];
afterEach(() => openDbs.splice(0).forEach((db) => db.close()));

function harness() {
  const db = openDb(':memory:');
  openDbs.push(db);
  const outbox = new FakeOutbox();
  const rooms = new RoomManager({ db, outbox, createBot: selfSoakingSlot1 });
  let now = 5_000_000;
  const member = (name: string): MemberInfo => {
    const { player } = loginOrCreate(db);
    return { playerId: player.id, name, tag: player.tag, animal: player.animal, hat: player.hat, level: levelFromXp(player.xp).level, hasNickname: true };
  };
  return {
    db,
    outbox,
    rooms,
    member,
    get now() {
      return now;
    },
    advance(ms: number) {
      const end = now + ms;
      while (now < end) {
        now += CONFIG.TICK_MS;
        rooms.tick(now);
      }
    },
    until(done: () => boolean, maxMs = 600_000) {
      const end = now + maxMs;
      while (!done()) {
        if (now > end) throw new Error('until: timed out');
        now += CONFIG.TICK_MS;
        rooms.tick(now);
      }
    },
  };
}

function opts(extra: Partial<CreateRoomOpts> = {}): CreateRoomOpts {
  return { name: '', size: 2, isPublic: true, theme: 'beach', roundsToWin: 3, botFill: false, ...extra };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ClientError);
    expect((err as ClientError).code).toBe(code);
    return;
  }
  throw new Error(`expected ClientError ${code}`);
}

// ---------------------------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------------------------

describe('RoomManager lobby', () => {
  it('creates a room: code, room_created, lobby_state with the creator as host, public listing', () => {
    const h = harness();
    const host = h.member('Hosty');
    const room = h.rooms.create(host, opts(), h.now);
    expect(room.code).toMatch(new RegExp(`^[${CONFIG.ROOM_CODE_ALPHABET}]{${CONFIG.ROOM_CODE_LEN}}$`));
    expect(h.outbox.of(host.playerId).map((m) => m.type)).toEqual(['room_created', 'lobby_state']);
    const lobby = h.outbox.last(host.playerId, 'lobby_state')!.lobby;
    expect(lobby).toMatchObject({ code: room.code, name: "Hosty's room", mode: 'duel', size: 2, phase: 'lobby', hostSlot: 0, yourSlot: 0, link: `/#/room/${room.code}` });
    expect(lobby.slots.map((s) => s.kind)).toEqual(['human', 'open']);
    expect(h.rooms.list()).toEqual([expect.objectContaining({ code: room.code, players: 1, maxPlayers: 2, joinable: true, host: `Hosty#${host.tag}` })]);
    expect(h.rooms.list('ffa')).toEqual([]);
    const priv = h.member('Secret');
    h.rooms.create(priv, opts({ isPublic: false, name: 'Hidden' }), h.now);
    expect(h.rooms.list()).toHaveLength(1);
  });

  it('lists a room under its default name when the chosen one fails the word filter', () => {
    const h = harness();
    const host = h.member('Hosty');
    const bad = h.rooms.create(host, opts({ name: 'OFFICIAL ADMIN fuck' }), h.now);
    expect(h.outbox.last(host.playerId, 'lobby_state')!.lobby.name).toBe("Hosty's room");
    const other = h.member('Clean');
    const good = h.rooms.create(other, opts({ name: 'Splash it up!' }), h.now);
    expect(h.rooms.list().map((r) => [r.code, r.name])).toEqual([
      [bad.code, "Hosty's room"],
      [good.code, 'Splash it up!'],
    ]);
  });

  it('joins by code with not_found / room_full / already_in_room / room_in_match errors', () => {
    const h = harness();
    const [a, b, c] = [h.member('Alpha'), h.member('Bravo'), h.member('Charlie')];
    const room = h.rooms.create(a, opts(), h.now);
    expectCode(() => h.rooms.join(b, 'ZZZZZZ', h.now), 'not_found');
    h.rooms.join(b, room.code, h.now);
    expect(h.outbox.last(b.playerId, 'lobby_state')!.lobby.yourSlot).toBe(1);
    expect(h.outbox.last(a.playerId, 'lobby_state')!.lobby.slots[1].name).toBe('Bravo');
    expectCode(() => h.rooms.join(c, room.code, h.now), 'room_full');
    expectCode(() => h.rooms.create(b, opts(), h.now), 'already_in_room');
    h.rooms.join(b, room.code, h.now);
    expect(h.rooms.roomOf(b.playerId)).toBe(room);

    const big = h.rooms.create(c, opts({ size: 4, botFill: true }), h.now);
    h.rooms.start(c.playerId, h.now);
    expectCode(() => h.rooms.join(h.member('Delta'), big.code, h.now), 'room_in_match');
  });

  it('lets only the host set non-human slots', () => {
    const h = harness();
    const [a, b] = [h.member('Alpha'), h.member('Bravo')];
    const room = h.rooms.create(a, opts({ size: 4 }), h.now);
    h.rooms.join(b, room.code, h.now);
    expectCode(() => h.rooms.setSlot(b.playerId, { slot: 2, kind: 'bot', difficulty: 'hard' }, h.now), 'not_host');
    expectCode(() => h.rooms.setSlot(a.playerId, { slot: 1, kind: 'closed' }, h.now), 'invalid');
    h.rooms.setSlot(a.playerId, { slot: 2, kind: 'bot', difficulty: 'hard' }, h.now);
    h.rooms.setSlot(a.playerId, { slot: 3, kind: 'closed' }, h.now);
    let slots = h.outbox.last(b.playerId, 'lobby_state')!.lobby.slots;
    expect(slots[2]).toMatchObject({ kind: 'bot', difficulty: 'hard', ready: true });
    expect(slots[2].name).toMatch(/^Bot /);
    expect(slots[3].kind).toBe('closed');
    const botName = slots[2].name;
    h.rooms.setSlot(a.playerId, { slot: 2, kind: 'bot', difficulty: 'easy' }, h.now);
    slots = h.outbox.last(b.playerId, 'lobby_state')!.lobby.slots;
    expect(slots[2]).toMatchObject({ difficulty: 'easy', name: botName });
    expect(h.rooms.list()[0]).toMatchObject({ players: 3, maxPlayers: 3, joinable: false });
  });

  it('starts only when guests are ready, fills bots when asked and needs two critters', () => {
    const h = harness();
    const [a, b] = [h.member('Alpha'), h.member('Bravo')];
    const room = h.rooms.create(a, opts(), h.now);
    expectCode(() => h.rooms.start(a.playerId, h.now), 'not_ready');
    h.rooms.join(b, room.code, h.now);
    expectCode(() => h.rooms.start(b.playerId, h.now), 'not_host');
    expectCode(() => h.rooms.start(a.playerId, h.now), 'not_ready');
    h.rooms.setReady(b.playerId, true, h.now);
    expect(h.outbox.last(a.playerId, 'lobby_state')!.lobby.slots[1].ready).toBe(true);
    h.rooms.start(a.playerId, h.now);
    expect(room.phase).toBe('in_match');
    expect(h.outbox.last(b.playerId, 'lobby_state')!.lobby.phase).toBe('in_match');
    expect(h.outbox.ofType(b.playerId, 'match_start')[0].config.yourSlot).toBe(1);

    const c = h.member('Charlie');
    const solo = h.rooms.create(c, opts({ size: 4, botFill: true }), h.now);
    h.rooms.start(c.playerId, h.now);
    const config = h.outbox.ofType(c.playerId, 'match_start')[0].config;
    expect(config.players.map((p) => p.isBot)).toEqual([false, true, true, true]);
    expect(config.players.every((p) => !p.isBot || p.difficulty === 'medium')).toBe(true);
    expect(solo.phase).toBe('in_match');
  });

  it('reassigns the host when the host leaves and closes a room its last human leaves', () => {
    const h = harness();
    const [a, b] = [h.member('Alpha'), h.member('Bravo')];
    const room = h.rooms.create(a, opts(), h.now);
    h.rooms.join(b, room.code, h.now);
    h.rooms.leave(a.playerId, h.now);
    expect(h.outbox.last(a.playerId, 'left_room')!.reason).toBe('left');
    expect(h.outbox.last(b.playerId, 'lobby_state')!.lobby).toMatchObject({ hostSlot: 1 });
    h.rooms.leave(b.playerId, h.now);
    expect(h.rooms.get(room.code)).toBeUndefined();
    expect(h.rooms.list()).toEqual([]);
  });

  it('frees a lobby seat on disconnect, keeps an empty room for ROOM_EMPTY_TTL_MS, then collects it', () => {
    const h = harness();
    const a = h.member('Alpha');
    const room = h.rooms.create(a, opts(), h.now);
    h.rooms.disconnected(a.playerId, h.now);
    expect(h.rooms.roomOf(a.playerId)).toBeUndefined();
    expect(room.seats[0].kind).toBe('open');
    h.advance(CONFIG.ROOM_EMPTY_TTL_MS / 2);
    h.rooms.join(a, room.code, h.now);
    expect(h.outbox.last(a.playerId, 'lobby_state')!.lobby).toMatchObject({ yourSlot: 0, hostSlot: 0 });
    h.rooms.disconnected(a.playerId, h.now);
    h.advance(CONFIG.ROOM_EMPTY_TTL_MS + 100);
    expect(h.rooms.get(room.code)).toBeUndefined();
  });

  it('closes a lobby that stayed idle for ROOM_IDLE_TTL_MS', () => {
    const h = harness();
    const a = h.member('Alpha');
    const room = h.rooms.create(a, opts(), h.now);
    h.advance(CONFIG.ROOM_IDLE_TTL_MS + 100);
    expect(h.rooms.get(room.code)).toBeUndefined();
    expect(h.outbox.last(a.playerId, 'left_room')!.reason).toBe('closed');
  });

  it('pushes the public room list to watchers at most twice a second', () => {
    const h = harness();
    const watcher = h.member('Watcher');
    h.rooms.watchList(watcher.playerId, true);
    expect(h.outbox.ofType(watcher.playerId, 'room_list')).toHaveLength(1);
    for (let i = 0; i < 5; i++) h.rooms.create(h.member(`Host${i}`), opts(), h.now);
    h.advance(1000);
    const lists = h.outbox.ofType(watcher.playerId, 'room_list');
    expect(lists.length).toBeLessThanOrEqual(3);
    expect(lists.at(-1)!.rooms).toHaveLength(5);
    h.rooms.watchList(watcher.playerId, false);
    h.rooms.create(h.member('Late'), opts(), h.now);
    h.advance(1000);
    expect(h.outbox.ofType(watcher.playerId, 'room_list')).toHaveLength(lists.length);
  });

  it('broadcasts emotes to the room with the sender slot', () => {
    const h = harness();
    const [a, b] = [h.member('Alpha'), h.member('Bravo')];
    const room = h.rooms.create(a, opts(), h.now);
    h.rooms.join(b, room.code, h.now);
    expect(h.rooms.emote(b.playerId, 2, h.now)).toBe(true);
    expect(h.outbox.last(a.playerId, 'emote')).toEqual({ type: 'emote', slot: 1, id: 2 });
    expect(h.rooms.emote(h.member('Nobody').playerId, 1, h.now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Matches, presence, rematch
// ---------------------------------------------------------------------------------------------

describe('RoomManager matches', () => {
  function startedDuel(h: ReturnType<typeof harness>) {
    const [a, b] = [h.member('Alpha'), h.member('Bravo')];
    const room = h.rooms.create(a, opts(), h.now);
    h.rooms.join(b, room.code, h.now);
    h.rooms.setReady(b.playerId, true, h.now);
    h.rooms.start(a.playerId, h.now);
    return { a, b, room };
  }

  it('idles a disconnected player, then hands the seat to a Medium bot after the grace period', () => {
    const h = harness();
    const { a, b, room } = startedDuel(h);
    h.advance(CONFIG.MATCH_INTRO_MS + CONFIG.ROUND_INTRO_MS + 500);
    h.rooms.disconnected(b.playerId, h.now);
    expect(h.outbox.last(a.playerId, 'player_status')).toMatchObject({ slot: 1, connected: false, replacedByBot: false });
    h.advance(CONFIG.RECONNECT_GRACE_MS + 100);
    expect(h.outbox.last(a.playerId, 'player_status')).toMatchObject({ slot: 1, connected: false, replacedByBot: true });
    expect(room.seats[1]).toMatchObject({ kind: 'bot', difficulty: 'medium' });
    expect(h.rooms.roomOf(b.playerId)).toBeUndefined();
    expect(h.rooms.reattach(b.playerId, h.now)).toBe(false);
    expect(room.runner!.participant(1)!.playerId).toBeNull();
  });

  it('re-attaches a returning player: lobby_state, match_start, round_start with the live grid and resumeTick', () => {
    const h = harness();
    const { a, b } = startedDuel(h);
    h.advance(CONFIG.MATCH_INTRO_MS + CONFIG.ROUND_INTRO_MS + 1000);
    h.rooms.disconnected(b.playerId, h.now);
    h.advance(2000);
    h.outbox.clear();
    expect(h.rooms.reattach(b.playerId, h.now)).toBe(true);
    const types = h.outbox.of(b.playerId).map((m) => m.type);
    expect(types.slice(0, 3)).toEqual(['lobby_state', 'match_start', 'round_start']);
    const roundStart = h.outbox.last(b.playerId, 'round_start')!;
    expect(roundStart.resumeTick).toBeGreaterThan(0);
    expect(h.outbox.last(a.playerId, 'player_status')).toMatchObject({ slot: 1, connected: true });
    h.advance(200);
    expect(h.outbox.ofType(b.playerId, 'snapshot').length).toBeGreaterThan(0);
  });

  it('tells a re-attached player which other seats went bot or offline while they were away', () => {
    const h = harness();
    const [a, b, c, d] = ['Ann', 'Ben', 'Cat', 'Dee'].map((n) => h.member(n));
    const room = h.rooms.create(a, opts({ size: 4 }), h.now);
    for (const m of [b, c, d]) {
      h.rooms.join(m, room.code, h.now);
      h.rooms.setReady(m.playerId, true, h.now);
    }
    h.rooms.start(a.playerId, h.now);
    h.advance(CONFIG.MATCH_INTRO_MS + CONFIG.ROUND_INTRO_MS + 500);
    h.rooms.disconnected(b.playerId, h.now);
    h.rooms.leave(c.playerId, h.now); // casual leaver -> bot takes slot 2
    h.rooms.disconnected(d.playerId, h.now); // still inside its grace period
    h.advance(1000);
    h.outbox.clear();
    expect(h.rooms.reattach(b.playerId, h.now)).toBe(true);
    const statuses = h.outbox.ofType(b.playerId, 'player_status');
    expect(statuses).toContainEqual(expect.objectContaining({ slot: 2, connected: false, replacedByBot: true }));
    expect(statuses).toContainEqual(expect.objectContaining({ slot: 3, connected: false, replacedByBot: false }));
    expect(statuses.some((s) => s.slot === 0)).toBe(false);
  });

  it('replaces an explicit leaver in a casual match with a bot immediately', () => {
    const h = harness();
    const { a, b, room } = startedDuel(h);
    h.rooms.leave(b.playerId, h.now);
    expect(h.outbox.last(b.playerId, 'left_room')!.reason).toBe('left');
    expect(room.seats[1].kind).toBe('bot');
    expect(h.outbox.last(a.playerId, 'player_status')).toMatchObject({ slot: 1, replacedByBot: true });
    h.rooms.leave(a.playerId, h.now);
    expect(h.rooms.get(room.code)).toBeUndefined();
  });

  it('opens a rematch vote after the match; a majority restarts, silence returns to the lobby', () => {
    const h = harness();
    const a = h.member('Alpha');
    const room = h.rooms.create(a, opts(), h.now);
    h.rooms.setSlot(a.playerId, { slot: 1, kind: 'bot', difficulty: 'easy' }, h.now);
    h.rooms.start(a.playerId, h.now);
    h.until(() => room.phase === 'results');
    const end = h.outbox.last(a.playerId, 'match_end')!;
    expect(end).toMatchObject({ canRematch: true, practice: false });
    expect(end.placements[0]).toMatchObject({ slot: 0, placement: 1, roundsWon: 3 });
    expect(end.xp[0].playerId).toBe(a.playerId);
    const results = h.outbox.last(a.playerId, 'lobby_state')!.lobby;
    expect(results.phase).toBe('results');
    expect(results.rematchDeadline).toBeGreaterThan(h.now);

    h.rooms.rematchVote(a.playerId, true, h.now);
    expect(room.phase).toBe('in_match');
    expect(h.outbox.ofType(a.playerId, 'match_start')).toHaveLength(2);

    h.until(() => room.phase === 'results');
    h.advance(CONFIG.REMATCH_VOTE_MS + 100);
    expect(room.phase).toBe('lobby');
    expect(h.outbox.last(a.playerId, 'lobby_state')!.lobby.phase).toBe('lobby');
  });

  it('needs a strict majority of connected humans; an impossible majority ends the vote early', () => {
    const h = harness();
    const finishedDuel = () => {
      const { a, b, room } = startedDuel(h);
      room.runner!.forfeit(1, h.now);
      expect(room.phase).toBe('results');
      return { a, b, room };
    };

    const first = finishedDuel();
    expectCode(() => h.rooms.join(h.member('Charlie'), first.room.code, h.now), 'room_in_match');
    h.rooms.rematchVote(first.a.playerId, true, h.now);
    expect(first.room.phase).toBe('results');
    expect(h.outbox.last(first.b.playerId, 'lobby_state')!.lobby.rematchVotes).toEqual([0]);
    h.rooms.rematchVote(first.b.playerId, true, h.now);
    expect(first.room.phase).toBe('in_match');

    const second = finishedDuel();
    h.rooms.rematchVote(second.a.playerId, true, h.now);
    h.rooms.rematchVote(second.b.playerId, false, h.now);
    expect(second.room.phase).toBe('lobby');
    expectCode(() => h.rooms.rematchVote(second.a.playerId, true, h.now), 'invalid');
  });

  it('frees the seat of a results-screen leaver; a rematch never starts with fewer than 2 critters', () => {
    const h = harness();
    const { a, b, room } = startedDuel(h);
    room.runner!.forfeit(1, h.now);
    h.rooms.rematchVote(a.playerId, true, h.now);
    h.rooms.leave(b.playerId, h.now);
    expect(room.seats[1].kind).toBe('open');
    expect(room.phase).toBe('lobby');
    expect(h.outbox.ofType(a.playerId, 'match_start')).toHaveLength(1);
  });
});

describe('RoomManager special rooms', () => {
  it('practice rooms are private, seat bots of the chosen difficulty and start at once', () => {
    const h = harness();
    const a = h.member('Solo');
    const room = h.rooms.create(a, opts({ size: 4, practice: true, practiceDifficulty: 'hard', isPublic: true }), h.now);
    expect(room.phase).toBe('in_match');
    expect(room.isPublic).toBe(false);
    expect(h.rooms.list()).toEqual([]);
    const types = h.outbox.of(a.playerId).map((m) => m.type);
    expect(types).toEqual(['room_created', 'lobby_state', 'match_start']);
    const config = h.outbox.last(a.playerId, 'match_start')!.config;
    expect(config.practice).toBe(true);
    expect(config.players.filter((p) => p.isBot).map((p) => p.difficulty)).toEqual(['hard', 'hard', 'hard']);
    expectCode(() => h.rooms.join(h.member('Other'), room.code, h.now), 'not_found');
    h.rooms.leave(a.playerId, h.now);
    expect(h.rooms.get(room.code)).toBeUndefined();
  });

  it('ranked rooms are hidden, start immediately, forfeit after the grace period and dissolve at match end', () => {
    const h = harness();
    const [a, b] = [h.member('Alpha'), h.member('Bravo')];
    const room = h.rooms.createRankedMatch('duel', [a, b], h.now);
    const found = h.outbox.last(a.playerId, 'match_found')!;
    expect(found).toMatchObject({ mode: 'duel', roomCode: room.code });
    expect(found.players.map((p) => [p.rating, p.tier])).toEqual([
      [1000, 'pond'],
      [1000, 'pond'],
    ]);
    expect(h.outbox.of(b.playerId).map((m) => m.type)).toEqual(['match_found', 'lobby_state', 'match_start']);
    expect(h.outbox.last(b.playerId, 'match_start')!.config.rules.revengeDucks).toBe(false);
    expect(h.rooms.list()).toEqual([]);
    expectCode(() => h.rooms.join(h.member('Spy'), room.code, h.now), 'not_found');

    h.advance(CONFIG.MATCH_INTRO_MS + 100);
    h.rooms.disconnected(b.playerId, h.now);
    h.advance(CONFIG.RECONNECT_GRACE_MS + 100);
    expect(h.outbox.last(a.playerId, 'player_status')).toMatchObject({ slot: 1, forfeited: true });
    const end = h.outbox.last(a.playerId, 'match_end')!;
    expect(end.ranked).toBe(true);
    expect(end.placements.map((p) => [p.slot, p.placement])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(end.ratingDeltas).toHaveLength(2);
    expect(h.outbox.last(a.playerId, 'left_room')!.reason).toBe('match_over');
    expect(h.rooms.get(room.code)).toBeUndefined();
    expect(h.rooms.roomOf(a.playerId)).toBeUndefined();
  });
});
