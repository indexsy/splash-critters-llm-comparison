/**
 * Fixed bugs, kept fixed: the parts a hostile or unlucky client can reach
 * without a socket in the way.
 *
 * Every test here failed against a real defect. The comments say what the
 * defect was, because the rule on its own does not explain why the test is
 * shaped the way it is.
 */

import { describe, expect, it } from 'vitest';
import { CONFIG, type CreateRoomOpts, type GameMode, type RatingInfo } from '@splash/shared';
import { GuestMintLimiter } from '../src/guestLimit.js';
import { MatchRunner, type MatchSink } from '../src/match.js';
import { parseClientMessage } from '../src/protocolGuards.js';
import { Room, type PlayerLookup } from '../src/room.js';

/** Everything a plain object inherits, which is not a message type. */
const INHERITED_KEYS = [
  '__proto__',
  'constructor',
  'valueOf',
  'toString',
  'toLocaleString',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
];

describe('protocol guard', () => {
  it('refuses every inherited Object key as a message type', () => {
    for (const key of INHERITED_KEYS) {
      // The bug: the validator table was indexed directly, so these resolved to
      // Object.prototype members. Most threw straight out of the ws listener
      // and took the whole server with them; `constructor` waved an entirely
      // unvalidated object through as a ClientMessage.
      const result = parseClientMessage(JSON.stringify({ t: key }));
      expect(result.ok, `type ${key} was accepted`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('bad_message');
        expect(result.reason).toContain('Unknown message type');
      }
    }
  });

  it('still accepts and still validates the real message types', () => {
    const good = parseClientMessage(JSON.stringify({ t: 'set_ready', ready: true }));
    expect(good).toEqual({ ok: true, message: { t: 'set_ready', ready: true } });

    const bad = parseClientMessage(JSON.stringify({ t: 'set_ready', ready: 'yes' }));
    expect(bad.ok).toBe(false);
  });
});

describe('guest minting brake', () => {
  it('lets an address mint up to the limit and then refuses it', () => {
    const limiter = new GuestMintLimiter(3, 60_000);
    const now = 1_000_000;

    expect(limiter.allow('1.2.3.4', now)).toBe(true);
    expect(limiter.allow('1.2.3.4', now)).toBe(true);
    expect(limiter.allow('1.2.3.4', now)).toBe(true);
    // The bug: nothing at all bounded this, so one socket could mint accounts
    // until the finite guest namespace ran out of names.
    expect(limiter.allow('1.2.3.4', now)).toBe(false);
    expect(limiter.countFor('1.2.3.4', now)).toBe(3);

    // A refusal must not extend the penalty, and must not spend somebody else's.
    expect(limiter.allow('1.2.3.4', now)).toBe(false);
    expect(limiter.allow('5.6.7.8', now)).toBe(true);
  });

  it('forgets mints once the window has passed', () => {
    const limiter = new GuestMintLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 500)).toBe(false);
    expect(limiter.allow('a', 1001)).toBe(true);
    expect(limiter.countFor('a', 1001)).toBe(1);
  });
});

// --------------------------------------------------------------- match results

const LOOKUP: PlayerLookup = {
  getById: () => null,
  getRating: (_id: string, mode: GameMode): RatingInfo => ({
    mode,
    rating: CONFIG.ELO_START,
    games: 0,
    wins: 0,
    peak: CONFIG.ELO_START,
  }),
};

const SILENT_SINK: MatchSink = { send: () => {}, broadcast: () => {}, latency: () => 0 };

function rankedDuel(code: string): Room {
  const opts: CreateRoomOpts = {
    name: 'Ranked Duel',
    size: 2,
    isPublic: false,
    theme: 'backyard',
    roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
    botFill: false,
  };
  const room = new Room(code, opts, true, null);
  room.addHuman('alice');
  room.addHuman('bob');
  return room;
}

describe('a match nobody stayed for', () => {
  it('places every forfeiter below first, so walking out is never a win', () => {
    const room = rankedDuel('FFEIT1');
    const runner = new MatchRunner(room, LOOKUP, SILENT_SINK);
    runner.begin();
    for (let tick = 0; tick < 200; tick++) runner.tick(Date.now() + tick * CONFIG.TICK_MS);

    runner.forfeit(0);
    runner.forfeit(1);
    for (let tick = 0; tick < 200 && !runner.finished; tick++) {
      runner.tick(Date.now() + (200 + tick) * CONFIG.TICK_MS);
    }

    const results = runner.results();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.forfeited)).toBe(true);
    // The bug: with nobody left standing, "the place below everyone who stayed"
    // computed to 1, so both quitters were placed first, both were credited
    // with a ranked win and both were paid first-place XP.
    expect(results.map((r) => r.placement)).toEqual([2, 2]);
    expect(results.some((r) => r.placement === 1)).toBe(false);
  });

  it('still ranks the survivor first when only one seat walks out', () => {
    const room = rankedDuel('FFEIT2');
    const runner = new MatchRunner(room, LOOKUP, SILENT_SINK);
    runner.begin();
    for (let tick = 0; tick < 200; tick++) runner.tick(Date.now() + tick * CONFIG.TICK_MS);

    runner.forfeit(1);
    for (let tick = 0; tick < 400 && !runner.finished; tick++) {
      runner.tick(Date.now() + (200 + tick) * CONFIG.TICK_MS);
    }

    const results = runner.results();
    expect(results.find((r) => r.slot === 0)?.placement).toBe(1);
    expect(results.find((r) => r.slot === 1)?.placement).toBe(2);
  });
});
