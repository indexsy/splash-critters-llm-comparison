import { describe, expect, it } from 'vitest';
import { CONFIG, type Mode, type MsgOf, type S2C } from '@splash/shared';
import { Matchmaker, groupFfa, pairDuel, searchRange, type QueueEntry } from '../src/matchmaker';
import type { MemberInfo } from '../src/match/types';
import { ClientError } from '../src/net/errors';
import type { Outbox } from '../src/net/outbox';

function member(id: string): MemberInfo {
  return { playerId: id, name: id, tag: '0001', animal: 'frog', hat: 'none', level: 1, hasNickname: true };
}

function entry(id: string, rating: number, joinedAt = 0, address: string | null = null): QueueEntry {
  return { member: member(id), rating, joinedAt, address };
}

const ids = (groups: QueueEntry[][]) => groups.map((g) => g.map((e) => e.member.playerId));

describe('searchRange', () => {
  it('starts at the base range, widens every MM_WIDEN_EVERY_MS and caps at MM_MAX_RANGE', () => {
    expect(searchRange(0)).toBe(CONFIG.MM_BASE_RANGE);
    expect(searchRange(CONFIG.MM_WIDEN_EVERY_MS - 1)).toBe(100);
    expect(searchRange(CONFIG.MM_WIDEN_EVERY_MS)).toBe(150);
    expect(searchRange(3 * CONFIG.MM_WIDEN_EVERY_MS + 5)).toBe(250);
    expect(searchRange(10 * 60_000)).toBe(CONFIG.MM_MAX_RANGE);
    expect(searchRange(-5)).toBe(100);
  });
});

describe('pairDuel', () => {
  it('pairs only when the gap fits both players ranges', () => {
    expect(pairDuel([entry('a', 1000), entry('b', 1100)], 0)).toHaveLength(1);
    expect(pairDuel([entry('a', 1000), entry('b', 1101)], 0)).toHaveLength(0);
    // a waited 20 s (range 200) but b just joined (range 100): the smaller range wins.
    expect(pairDuel([entry('a', 1000, 0), entry('b', 1150, 20_000)], 20_000)).toHaveLength(0);
    expect(pairDuel([entry('a', 1000, 0), entry('b', 1150, 10_000)], 20_000)).toHaveLength(1);
  });

  it('serves the longest waiter first with their closest valid opponent', () => {
    const queue = [entry('new', 1040, 9000), entry('old', 1000, 0), entry('close', 1010, 5000), entry('far', 1090, 1000)];
    expect(ids(pairDuel(queue, 9000))).toEqual([
      ['old', 'close'],
      ['far', 'new'],
    ]);
  });

  it('widens over time until a lonely pair finally matches', () => {
    const queue = [entry('a', 1000, 0), entry('b', 1320, 0)];
    expect(pairDuel(queue, 0)).toHaveLength(0);
    expect(pairDuel(queue, 40_000)).toHaveLength(0);
    expect(pairDuel(queue, 50_000)).toHaveLength(1);
    expect(pairDuel([entry('a', 1000), entry('b', 1401)], 3_600_000)).toHaveLength(0);
  });

  it('with address separation on, never pairs two entries from one client address', () => {
    const main = entry('main', 1000, 0, '203.0.113.7');
    const alt = entry('alt', 1000, 0, '203.0.113.7');
    expect(pairDuel([main, alt], 0, true)).toEqual([]);
    expect(pairDuel([main, alt], 3_600_000, true)).toEqual([]);
    // Someone else still gets a game with either of them, even when the alt is the closer rating.
    const other = entry('other', 1060, 0, '198.51.100.2');
    expect(ids(pairDuel([main, alt, other], 0, true))).toEqual([['main', 'other']]);
  });

  it('by default pairs players who share an address (two tabs, a household) and clients without one', () => {
    expect(pairDuel([entry('a', 1000, 0, '203.0.113.7'), entry('b', 1000, 0, '203.0.113.7')], 0)).toHaveLength(1);
    expect(pairDuel([entry('tab1', 1000), entry('tab2', 1000)], 0, true)).toHaveLength(1);
  });
});

describe('groupFfa', () => {
  it('groups 4 players whose spread fits every member range and leaves the rest', () => {
    const queue = [entry('a', 1000), entry('b', 1030), entry('c', 1060), entry('d', 1090), entry('e', 1500)];
    expect(ids(groupFfa(queue, 0))).toEqual([['a', 'b', 'c', 'd']]);
    expect(groupFfa(queue.slice(0, 3), 0)).toEqual([]);
  });

  it('rejects a group whose spread exceeds a newcomer range, accepts it once everyone widened', () => {
    const queue = [entry('a', 1000, 0), entry('b', 1050, 0), entry('c', 1100, 0), entry('d', 1180, 0)];
    expect(groupFfa(queue, 0)).toEqual([]);
    expect(ids(groupFfa(queue, 20_000))).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('picks the tightest group around the longest waiter and can form several groups', () => {
    const queue = [
      ...['a', 'b', 'c', 'd'].map((id, i) => entry(id, 1000 + i * 10, i)),
      ...['e', 'f', 'g', 'h'].map((id, i) => entry(id, 1600 + i * 10, 100 + i)),
      entry('x', 1045, 500),
    ];
    const groups = ids(groupFfa(queue, 1000));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(['a', 'b', 'c', 'd']);
    expect(groups[1]).toEqual(['e', 'f', 'g', 'h']);
  });

  it('with address separation on, keeps entries from one client address out of the same group', () => {
    const shared = '203.0.113.7';
    const queue = [
      entry('main', 1000, 0, shared),
      entry('alt1', 1000, 1, shared),
      entry('b', 1010, 2, '198.51.100.1'),
      entry('c', 1020, 3, '198.51.100.2'),
      entry('alt2', 1005, 4, shared),
    ];
    expect(groupFfa(queue, 0, true)).toEqual([]);
    const withD = [...queue, entry('d', 1030, 5, '198.51.100.3')];
    const groups = ids(groupFfa(withD, 0, true));
    expect(groups).toEqual([['main', 'b', 'c', 'd']]);
    expect(ids(groupFfa(withD, 0, false))).toEqual([['main', 'alt1', 'b', 'alt2']]);
  });
});

class RecordingOutbox implements Outbox {
  readonly sent: { to: string; msg: S2C }[] = [];
  send(to: string, msg: S2C): void {
    this.sent.push({ to, msg });
  }
  rtt(): number {
    return -1;
  }
  statuses(to: string): MsgOf<S2C, 'queue_status'>[] {
    return this.sent.filter((s) => s.to === to && s.msg.type === 'queue_status').map((s) => s.msg as MsgOf<S2C, 'queue_status'>);
  }
}

describe('Matchmaker', () => {
  function setup(separateAddresses = false) {
    const outbox = new RecordingOutbox();
    const matched: { mode: Mode; ids: string[]; at: number }[] = [];
    const mm = new Matchmaker({
      outbox,
      onMatched: (mode, members, now) => matched.push({ mode, ids: members.map((m) => m.playerId), at: now }),
      separateAddresses,
    });
    return { outbox, matched, mm };
  }

  it('sends queue_status on join and on every matchmaking tick, with widening search range', () => {
    const { outbox, mm } = setup();
    mm.join(member('a'), 1000, 'duel', 0);
    expect(outbox.statuses('a')[0]).toEqual({ type: 'queue_status', mode: 'duel', elapsedMs: 0, searchRange: 100, eta: -1, inQueue: 1 });
    for (let t = 0; t <= 12_020; t += CONFIG.TICK_MS) mm.tick(t);
    const last = outbox.statuses('a').at(-1)!;
    expect(last.searchRange).toBe(150);
    expect(last.elapsedMs).toBeGreaterThanOrEqual(10_000);
    // One status per MM_TICK_MS (plus the join status), not per 30 Hz tick.
    expect(outbox.statuses('a').length).toBe(1 + Math.floor(12_000 / CONFIG.MM_TICK_MS) + 1);
  });

  it('matches a duel pair only on a matchmaking tick and removes them from the queue', () => {
    const { mm, matched } = setup();
    mm.join(member('a'), 1000, 'duel', 0);
    mm.tick(0);
    mm.join(member('b'), 1050, 'duel', 500);
    mm.tick(CONFIG.MM_TICK_MS - 1);
    expect(matched).toHaveLength(0);
    mm.tick(CONFIG.MM_TICK_MS);
    expect(matched).toEqual([{ mode: 'duel', ids: ['a', 'b'], at: CONFIG.MM_TICK_MS }]);
    expect(mm.size('duel')).toBe(0);
    expect(mm.modeOf('a')).toBeNull();
  });

  it('with address separation on, does not match two queued players from the same client address', () => {
    const { mm, matched } = setup(true);
    mm.join(member('main'), 1000, 'duel', 0, '203.0.113.7');
    mm.join(member('alt'), 1000, 'duel', 0, '203.0.113.7');
    mm.run(120_000);
    expect(matched).toEqual([]);
    mm.join(member('rival'), 1000, 'duel', 120_000, '198.51.100.9');
    mm.run(122_000);
    expect(matched).toEqual([{ mode: 'duel', ids: ['main', 'rival'], at: 122_000 }]);
    expect(mm.modeOf('alt')).toBe('duel');
  });

  it('keeps the queues separate, rejects a second mode and leaves cleanly', () => {
    const { mm, matched } = setup();
    mm.join(member('a'), 1000, 'ffa', 0);
    mm.join(member('a'), 1000, 'ffa', 10);
    expect(mm.size('ffa')).toBe(1);
    expect(() => mm.join(member('a'), 1000, 'duel', 20)).toThrow(ClientError);
    mm.join(member('b'), 1000, 'duel', 0);
    mm.run(5000);
    expect(matched).toHaveLength(0);
    expect(mm.leave('a')).toBe(true);
    expect(mm.leave('a')).toBe(false);
    expect(mm.modeOf('a')).toBeNull();
  });

  it('forms FFA groups of four and estimates eta from recent waits', () => {
    const { mm, matched, outbox } = setup();
    ['a', 'b', 'c', 'd'].forEach((id, i) => mm.join(member(id), 1000 + i * 20, 'ffa', i * 1000));
    mm.run(10_000);
    expect(matched).toEqual([{ mode: 'ffa', ids: ['a', 'b', 'c', 'd'], at: 10_000 }]);
    mm.join(member('e'), 1000, 'ffa', 11_000);
    const eta = outbox.statuses('e').at(-1)!.eta;
    expect(eta).toBeGreaterThan(0);
    mm.run(60_000);
    expect(outbox.statuses('e').at(-1)!.eta).toBe(-1);
  });
});
