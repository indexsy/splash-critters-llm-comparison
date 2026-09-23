import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, Dir, decodeTiles, type MsgOf, type PlayerInput, type RoundState, type S2C, type S2CType } from '@splash/shared';
import { loginOrCreate } from '../src/accounts';
import { createBot } from '../src/bots/bot';
import { getRating, getRecentMatches, openDb, type Db } from '../src/db';
import { MatchRunner } from '../src/gameLoop';
import { InputQueues, STARVED_TICKS } from '../src/match/inputs';
import type { BotBrain, BotFactory, MatchParticipant, MatchSetup, RoomKind } from '../src/match/types';
import type { Outbox } from '../src/net/outbox';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

class FakeOutbox implements Outbox {
  readonly sent = new Map<string, S2C[]>();
  send(playerId: string, msg: S2C): void {
    const list = this.sent.get(playerId) ?? [];
    list.push(msg);
    this.sent.set(playerId, list);
  }
  rtt(): number {
    return 42;
  }
  of(playerId: string): S2C[] {
    return this.sent.get(playerId) ?? [];
  }
  ofType<T extends S2CType>(playerId: string, type: T): MsgOf<S2C, T>[] {
    return this.of(playerId).filter((m): m is MsgOf<S2C, T> => m.type === type);
  }
}

type Script = 'idle' | 'self_soak';

/** Scripted brains: 'idle' never acts, 'self_soak' drops a balloon on its own tile and waits. */
function scriptedBots(plan: Record<number, Script>): BotFactory {
  return (slot, difficulty) => {
    const brain: BotBrain = {
      slot,
      difficulty,
      nextInput: (_state: RoundState): PlayerInput => ({ seq: 0, dir: Dir.None, balloon: plan[slot] === 'self_soak' }),
      reset: () => undefined,
    };
    return brain;
  };
}

const openDbs: Db[] = [];
function memoryDb(): Db {
  const db = openDb(':memory:');
  openDbs.push(db);
  return db;
}
afterEach(() => openDbs.splice(0).forEach((db) => db.close()));

function human(slot: number, playerId: string): MatchParticipant {
  return { slot, playerId, name: `P${slot}`, tag: '0001', animal: 'frog', hat: 'none', level: 1 };
}

function bot(slot: number): MatchParticipant {
  return { slot, playerId: null, difficulty: 'medium', name: `Bot ${slot}`, tag: '', animal: 'duck', hat: 'none', level: 1 };
}

function setup(kind: RoomKind, participants: MatchParticipant[], extra: Partial<MatchSetup> = {}): MatchSetup {
  const mode = participants.length > 2 || extra.size === 4 ? 'ffa' : 'duel';
  const { w, h } = CONFIG.MODES[mode];
  return {
    matchId: `m-${Math.random().toString(36).slice(2)}`,
    roomCode: 'ABCDEF',
    kind,
    mode,
    size: CONFIG.MODES[mode].maxPlayers,
    w,
    h,
    roundsToWin: 3,
    theme: 'random',
    participants,
    seed: 12345,
    ...extra,
  };
}

/** Steps a runner in fixed 30 Hz increments of fake time. */
class Clock {
  now = 1_000_000;
  constructor(private readonly runner: MatchRunner) {}
  advance(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) this.step();
  }
  step(): void {
    this.now += CONFIG.TICK_MS;
    this.runner.tick(this.now);
  }
  until(done: () => boolean, maxMs = 600_000): void {
    const end = this.now + maxMs;
    while (!done()) {
      if (this.now > end) throw new Error('Clock.until: timed out');
      this.step();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Input queues
// ---------------------------------------------------------------------------------------------

describe('InputQueues', () => {
  it('pops in order, repeats the last direction when empty and never repeats a press', () => {
    const q = new InputQueues(2);
    q.push(0, { seq: 1, dir: Dir.Up, balloon: true });
    q.push(0, { seq: 2, dir: Dir.Left, balloon: false });
    expect(q.next(0)).toEqual({ seq: 1, dir: Dir.Up, balloon: true });
    expect(q.next(0)).toEqual({ seq: 2, dir: Dir.Left, balloon: false });
    expect(q.next(0)).toEqual({ seq: 2, dir: Dir.Left, balloon: false });
    expect(q.ack(0)).toBe(2);
  });

  it('stops repeating the last direction once no input arrived for STARVED_TICKS', () => {
    const q = new InputQueues(1);
    q.push(0, { seq: 1, dir: Dir.Right, balloon: false });
    q.next(0);
    for (let i = 1; i < STARVED_TICKS; i++) expect(q.next(0).dir).toBe(Dir.Right);
    expect(q.next(0).dir).toBe(Dir.None);
    q.push(0, { seq: 2, dir: Dir.Up, balloon: false });
    expect(q.next(0).dir).toBe(Dir.Up);
    expect(q.next(0).dir).toBe(Dir.Up);
  });

  it('ignores inputs whose seq does not strictly increase', () => {
    const q = new InputQueues(1);
    expect(q.push(0, { seq: 5, dir: Dir.Up, balloon: false })).toBe(true);
    expect(q.push(0, { seq: 5, dir: Dir.Down, balloon: false })).toBe(false);
    expect(q.push(0, { seq: 3, dir: Dir.Down, balloon: false })).toBe(false);
    expect(q.next(0).dir).toBe(Dir.Up);
  });

  it('drops the oldest input when full but carries its balloon press forward', () => {
    const q = new InputQueues(1, 3);
    q.push(0, { seq: 1, dir: Dir.Up, balloon: true });
    for (let seq = 2; seq <= 4; seq++) q.push(0, { seq, dir: Dir.Right, balloon: false });
    const first = q.next(0);
    expect(first.seq).toBe(2);
    expect(first.balloon).toBe(true);
  });

  it('idle clears queued inputs and stops movement; resetSeq accepts a restarted counter', () => {
    const q = new InputQueues(1);
    q.push(0, { seq: 10, dir: Dir.Right, balloon: false });
    q.next(0);
    q.idle(0);
    expect(q.next(0).dir).toBe(Dir.None);
    expect(q.push(0, { seq: 1, dir: Dir.Up, balloon: false })).toBe(false);
    q.resetSeq(0);
    expect(q.push(0, { seq: 1, dir: Dir.Up, balloon: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------------------------

describe('MatchRunner', () => {
  it('plays a full 2-bot practice match to match_end with fake time', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    let finished: MsgOf<S2C, 'match_end'> | null = null;
    const runner = new MatchRunner(setup('practice', [bot(0), bot(1)]), { db, outbox, createBot: scriptedBots({ 1: 'self_soak' }) }, {
      onFinished: (end) => (finished = end),
    });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'ended');
    expect(finished).not.toBeNull();
    const end = finished!;
    expect(end.practice).toBe(true);
    expect(end.ratingDeltas).toBeNull();
    expect(end.xp).toEqual([]);
    expect(runner.roundNo).toBe(3);
    expect(end.placements.map((p) => [p.slot, p.placement, p.roundsWon, p.isBot])).toEqual([
      [0, 1, 3, true],
      [1, 2, 0, true],
    ]);
    expect(end.funStats.find((f) => f.id === 'longest_survivor')?.slot).toBe(0);
    expect(end.canRematch).toBe(false);
  });

  it('plays a full practice match with the real bots (Hard vs Easy) to match_end', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const hard = { ...bot(0), difficulty: 'hard' as const };
    const easy = { ...bot(1), difficulty: 'easy' as const };
    const runner = new MatchRunner(setup('practice', [hard, easy], { seed: 777 }), { db, outbox, createBot });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'ended', 40 * 60_000);
    const end = runner.result!;
    const winner = end.placements[0];
    expect(Math.max(...end.placements.map((p) => p.roundsWon))).toBeGreaterThanOrEqual(1);
    expect(end.placements.map((p) => p.slot).sort()).toEqual([0, 1]);
    expect(winner.placement).toBe(1);
    expect(runner.roundNo).toBeLessThanOrEqual(CONFIG.MAX_ROUNDS);
  }, 60_000);

  it('streams the whole protocol to a human and persists XP (practice rate)', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const pid = loginOrCreate(db).player.id;
    const runner = new MatchRunner(setup('practice', [human(0, pid), bot(1)]), { db, outbox, createBot: scriptedBots({ 1: 'self_soak' }) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'ended');

    const types = outbox.of(pid).map((m) => m.type);
    expect(types[0]).toBe('match_start');
    expect(types.filter((t) => t === 'round_start')).toHaveLength(3);
    expect(types.filter((t) => t === 'round_end')).toHaveLength(3);
    expect(types.slice(-2)).toEqual(['match_end', 'profile']);
    expect(types.indexOf('round_start')).toBeLessThan(types.indexOf('snapshot'));

    const config = outbox.ofType(pid, 'match_start')[0].config;
    expect(config).toMatchObject({ yourSlot: 0, practice: true, ranked: false, tutorial: false, w: 13, h: 11 });
    expect(config.players.map((p) => p.isBot)).toEqual([false, true]);

    const snaps = outbox.ofType(pid, 'snapshot');
    expect(snaps.every((s) => s.tick % CONFIG.SNAPSHOT_EVERY_TICKS === 0)).toBe(true);
    expect(snaps[0].pings).toEqual([42, -1]);
    expect(snaps[0].players.map((p) => p.slot)).toEqual([0, 1]);

    const events = outbox.ofType(pid, 'event').flatMap((e) => e.events);
    expect(events.some((e) => e.type === 'balloon_placed')).toBe(true);
    expect(events.filter((e) => e.type === 'round_over')).toHaveLength(3);

    const ends = outbox.ofType(pid, 'round_end');
    expect(ends.map((e) => e.winner)).toEqual([0, 0, 0]);
    expect(ends.map((e) => e.matchOver)).toEqual([false, false, true]);
    expect(ends[2].scores).toEqual([3, 0]);
    // The survivor's time stops at round_over, not after the settle phase the runner keeps stepping.
    const overTicks = outbox.ofType(pid, 'event').filter((e) => e.events.some((ev) => ev.type === 'round_over')).map((e) => e.tick);
    expect(ends.map((e) => e.summaries.map((p) => p.survivedTicks))).toEqual(overTicks.map((t) => [t, t]));

    const matchEnd = outbox.ofType(pid, 'match_end')[0];
    const totalTicks = overTicks.reduce((sum, t) => sum + t, 0);
    expect(matchEnd.placements.map((p) => p.survivedTicks)).toEqual([totalTicks, totalTicks]);
    expect(matchEnd.xp).toHaveLength(1);
    expect(matchEnd.xp[0].playerId).toBe(pid);
    const recent = getRecentMatches(db, pid, 5);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ placement: 1, roundsWon: 3, ranked: false, xpEarned: matchEnd.xp[0].earned });
  });

  it('runs no ticks during the intro and countdown and ignores inputs until live', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const pid = loginOrCreate(db).player.id;
    const runner = new MatchRunner(setup('casual', [human(0, pid), bot(1)]), { db, outbox, createBot: scriptedBots({}) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    expect(runner.phase).toBe('intro');
    clock.advance(CONFIG.MATCH_INTRO_MS);
    expect(runner.phase).toBe('countdown');
    const roundStart = outbox.ofType(pid, 'round_start')[0];
    expect(roundStart.startTime).toBeGreaterThanOrEqual(clock.now + CONFIG.ROUND_INTRO_MS - CONFIG.TICK_MS);
    expect(runner.pushInput(0, { seq: 1, dir: Dir.Down, balloon: true }, clock.now)).toBe(false);
    clock.advance(CONFIG.ROUND_INTRO_MS - 2 * CONFIG.TICK_MS);
    expect(runner.state!.tick).toBe(0);
    // Still before tick 0 (startTime): a key held during 3-2-1 must not queue anything.
    expect(runner.pushInput(0, { seq: 1, dir: Dir.Down, balloon: true }, roundStart.startTime - 1)).toBe(false);
    clock.until(() => runner.phase === 'live');
    expect(runner.state!.tick).toBe(1);
    expect(runner.pushInput(0, { seq: 1, dir: Dir.Down, balloon: false }, clock.now)).toBe(true);
    const y0 = runner.state!.players[0].y;
    clock.step();
    expect(runner.state!.players[0].y).toBeGreaterThan(y0);
    expect(outbox.ofType(pid, 'snapshot').at(-1)?.ack ?? 1).toBe(1);
  });

  it('re-sends match_start and the current grid with resumeTick on resync', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const pid = loginOrCreate(db).player.id;
    const runner = new MatchRunner(setup('casual', [human(0, pid), bot(1)]), { db, outbox, createBot: scriptedBots({}) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'live' && runner.state!.tick >= 40);
    outbox.sent.clear();
    expect(runner.resync(pid)).toBe(true);
    // A round still being played has no outcome to repeat.
    expect(outbox.of(pid).map((m) => m.type)).toEqual(['match_start', 'round_start']);
    const rs = outbox.ofType(pid, 'round_start')[0];
    expect(rs.resumeTick).toBe(runner.state!.tick);
    expect(decodeTiles(rs.castleGrid)).toEqual(runner.state!.tiles);
    expect(runner.resync('someone-else')).toBe(false);
  });

  it('repeats the round_over event to a player re-attaching while the round settles', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const pid = loginOrCreate(db).player.id;
    const runner = new MatchRunner(setup('casual', [human(0, pid), bot(1)]), { db, outbox, createBot: scriptedBots({ 1: 'self_soak' }) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'settling');
    const original = outbox.ofType(pid, 'event').find((e) => e.events.some((ev) => ev.type === 'round_over'))!;
    clock.step();
    outbox.sent.clear();
    expect(runner.resync(pid)).toBe(true);
    expect(outbox.of(pid).map((m) => m.type)).toEqual(['match_start', 'round_start', 'event']);
    expect(outbox.ofType(pid, 'round_start')[0].resumeTick).toBe(runner.state!.tick);
    // Same outcome and tick as the broadcast the player missed: the client's world goes over, so
    // it stops predicting moves the settling server rejects and announces the winner.
    const repeated = outbox.ofType(pid, 'event')[0];
    expect(repeated).toEqual({ type: 'event', tick: original.tick, events: [{ type: 'round_over', winner: 0, draw: false }] });
    expect(runner.state!.tick).toBeGreaterThan(repeated.tick);
    expect(runner.pushInput(0, { seq: 1, dir: Dir.Right, balloon: false }, clock.now)).toBe(false);
  });

  it('accepts a GO press sent in the final countdown period and applies it on tick 1', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const pid = loginOrCreate(db).player.id;
    const runner = new MatchRunner(setup('casual', [human(0, pid), bot(1)]), { db, outbox, createBot: scriptedBots({}) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.advance(CONFIG.MATCH_INTRO_MS);
    const { startTime } = outbox.ofType(pid, 'round_start')[0];
    clock.until(() => clock.now >= startTime);
    expect(runner.phase).toBe('countdown');
    // A client whose clock runs a few ms ahead sends its first input just before tick 1.
    expect(runner.pushInput(0, { seq: 1, dir: Dir.Down, balloon: true }, clock.now)).toBe(true);
    clock.until(() => runner.phase === 'live');
    expect(runner.state!.balloons.some((b) => b.owner === 0)).toBe(true);
    expect(outbox.ofType(pid, 'snapshot').at(-1)?.ack ?? 1).toBe(1);
  });

  it('hands a slot to a bot mid-match: the human stops receiving match traffic and is not persisted', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const pid = loginOrCreate(db).player.id;
    const runner = new MatchRunner(setup('casual', [human(0, pid), bot(1)]), { db, outbox, createBot: scriptedBots({ 1: 'self_soak' }) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'live');
    runner.replaceWithBot(0, bot(0));
    const before = outbox.of(pid).length;
    clock.until(() => runner.phase === 'ended');
    expect(outbox.of(pid).slice(before)).toEqual([]);
    const placements = runner.result!.placements;
    expect(placements.find((p) => p.slot === 0)).toMatchObject({ isBot: true, playerId: null, placement: 1, roundsWon: 3 });
    expect(runner.result!.canRematch).toBe(true);
    expect(getRecentMatches(db, pid, 5)).toHaveLength(0);
  });

  it('ends a ranked duel at once on forfeit: the opponent wins, both are rated', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const [a, b] = [loginOrCreate(db).player.id, loginOrCreate(db).player.id];
    const runner = new MatchRunner(setup('ranked', [human(0, a), human(1, b)]), { db, outbox, createBot: scriptedBots({}) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'live' && runner.state!.tick > 10);
    runner.forfeit(1, clock.now);
    expect(runner.phase).toBe('ended');
    const end = runner.result!;
    expect(end.ranked).toBe(true);
    expect(end.placements.map((p) => [p.slot, p.placement, p.forfeited])).toEqual([
      [0, 1, false],
      [1, 2, true],
    ]);
    expect(end.ratingDeltas!.find((d) => d.slot === 0)!.delta).toBeGreaterThan(0);
    expect(end.ratingDeltas!.find((d) => d.slot === 1)!.delta).toBeLessThan(0);
    expect(getRating(db, a, 'duel')).toMatchObject({ games: 1, wins: 1 });
    expect(getRating(db, b, 'duel')).toMatchObject({ games: 1, wins: 0 });
    expect(outbox.ofType(a, 'match_end')).toHaveLength(1);
    expect(outbox.ofType(b, 'match_end')).toHaveLength(0);
    expect(outbox.ofType(b, 'profile')).toHaveLength(1);
    expect(end.xp.find((x) => x.playerId === b)!.earned).toBe(0);
  });

  it('removes an FFA forfeiter from the running round and later rounds, placing them last', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const ids = [0, 1, 2, 3].map(() => loginOrCreate(db).player.id);
    const runner = new MatchRunner(setup('ranked', ids.map((id, slot) => human(slot, id))), { db, outbox, createBot: scriptedBots({}) });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'live' && runner.state!.tick > 5);
    runner.forfeit(3, clock.now);
    expect(runner.state!.players[3].present).toBe(false);
    expect(runner.phase).toBe('live');
    clock.step();
    clock.step();
    const snap = outbox.ofType(ids[0], 'snapshot').at(-1)!;
    expect(snap.players.map((p) => p.slot)).toEqual([0, 1, 2]);
    runner.forfeit(2, clock.now);
    runner.forfeit(1, clock.now);
    expect(runner.phase).toBe('ended');
    const placements = runner.result!.placements;
    expect(placements[0]).toMatchObject({ slot: 0, placement: 1, forfeited: false });
    expect(placements.slice(1).every((p) => p.forfeited && p.placement === 2)).toBe(true);
    expect(runner.result!.ratingDeltas).toHaveLength(4);
    expect(runner.result!.ratingDeltas!.find((d) => d.slot === 0)!.delta).toBeGreaterThan(0);
  });

  it('keeps running when a bot throws (the slot idles) instead of taking the match down', () => {
    const db = memoryDb();
    const outbox = new FakeOutbox();
    const broken: BotFactory = (slot, difficulty) => ({
      slot,
      difficulty,
      nextInput: () => {
        throw new Error('bot bug');
      },
      reset: () => undefined,
    });
    const runner = new MatchRunner(setup('practice', [bot(0), bot(1)]), { db, outbox, createBot: broken });
    const clock = new Clock(runner);
    runner.start(clock.now);
    clock.until(() => runner.phase === 'live' && runner.state!.tick > 30);
    expect(runner.state!.players.every((p) => p.alive)).toBe(true);
  });
});
