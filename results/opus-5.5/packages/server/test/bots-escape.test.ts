// Escapes under pressure (regressions from the bot soak's self-soak reports): a bot that found no
// safe tile keeps looking for one, re-planned escapes do not idle in the bot's own splash lines,
// a refuge is judged over the same horizon everywhere, Hard re-plans the moment its way ahead is
// sealed, and the careful checks see opponents and revenge ducks as early as they can strike.
import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  Dir,
  idx,
  simulateTick,
  speedUnitsPerTick,
  tileCenter,
  tileOf,
  type Difficulty,
  type GameEvent,
  type RoundState,
} from '@splash/shared';
import { createBot } from '../src/bots/bot';
import { makeContext, opponentTicks, type BotContext } from '../src/bots/context';
import { DangerMap } from '../src/bots/dangerMap';
import { lobbedSplashes } from '../src/bots/hijack';
import { searchReach } from '../src/bots/pathing';
import { escapeSearches, searchFromHere } from '../src/bots/reach';
import { makePlan, steer } from '../src/bots/steer';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

const CALM = { tide: false, revengeDucks: false };

function contextOf(s: RoundState, difficulty: Difficulty = 'hard'): BotContext {
  const exact = DangerMap.fromState(s);
  return makeContext({ s, slot: 0, tuning: CONFIG.BOTS[difficulty], difficulty, passive: false, rng: () => 0, exact, view: exact });
}

/** Runs the bot (slot 0) against an idle opponent until `until`; returns the tick the bot was soaked, -1 if never. */
function runBot(s: RoundState, until: number): number {
  const bot = createBot(0, 'hard', 7);
  let soaked = -1;
  while (!s.over && s.tick < until) {
    const events: GameEvent[] = simulateTick(s, [bot.nextInput(s), null]);
    if (soaked < 0 && events.some((e) => e.type === 'player_soaked' && e.slot === 0)) soaked = s.tick;
  }
  return soaked;
}

describe('escapes', () => {
  it('leaves a last-resort refuge as soon as a way out opens', () => {
    // Regression (soak hard-ffa#0, seed 3919213289, round 9): with nothing safe in reach the bot
    // held the tile that stayed dry the longest, and never looked again while that tile was dry,
    // so it sat out a one-tick chance to slip out and was soaked by its own cascade. Here the bot
    // on (3,4) is shut in by its own balloon on (3,3) (it bursts on tick 40) and a castle on (3,5);
    // the opponent's balloon on (3,7) washes the castle away on tick 20 and the way down is dry
    // from tick 32 on.
    const s = stateFromAscii(['#######', '#....1#', '#.#.#.#', '#.....#', '#.#0#.#', '###C###', '###.###', '#.....#', '#######'], {
      rules: CALM,
    });
    s.players[0].maxBalloons = 1;
    putBalloon(s, 3, 3, 0, { fuse: 40, range: 1 });
    putBalloon(s, 3, 7, 1, { fuse: 20, range: 2 });
    expect(runBot(s, 45)).toBe(-1);
    expect(tileOf(s.players[0].y)).toBe(5);
  });

  it('re-plans an escape without a long wait in its own splash lines when there is another way out', () => {
    // Regression (soak hard-ffa#2, seed 1760964653, round 13): its planned way out closed, the bot
    // re-routed to the same refuge by waiting on its own balloon's tile for 75 ticks, and an
    // opponent chained into its cascade meanwhile. Here the bot stands on its own balloon on (3,3)
    // (it bursts on tick 90); the way up is under water until tick 45, the way left is open.
    const s = stateFromAscii(['#######', '#.....#', '###.###', '#..0..#', '#######', '#1....#', '#######'], { rules: CALM });
    putBalloon(s, 3, 3, 0, { fuse: 90, range: 1 });
    s.splashUntil[idx(s.w, 3, 2)] = 45;
    const ctx = contextOf(s);
    const up = idx(s.w, 3, 1);
    const left = idx(s.w, 1, 3);
    expect(searchFromHere(ctx).campAt[up]).toBeLessThan(Infinity);
    const [brisk] = escapeSearches(ctx).map((search) => search());
    expect(brisk.campAt[up]).toBe(Infinity);
    expect(brisk.campAt[left]).toBeLessThan(Infinity);
  });

  it("keeps following an escape whose refuge stays campable for as long as the bot's checks ask", () => {
    // Regression: the new-danger reflex asked the refuge to stay dry a full camping horizon past
    // the planned ARRIVAL while the escape checks (and the search) ask it from NOW, so an escape to
    // a refuge flooding in between was dropped and re-planned unchanged on every tick: the bot
    // froze on its own balloon until it burst. Here the refuge (3,1) is reached on tick 12 and
    // stays dry until tick 132: past the camping horizon from now (122), short of the one from the
    // arrival (134).
    const s = stateFromAscii(['#######', '#0....#', '#.#.#.#', '#.....#', '#.#.#.#', '#....1#', '#######'], { rules: CALM });
    putBalloon(s, 4, 1, 1, { fuse: 132, range: 1 });
    const plan = makePlan('escape', { tiles: [idx(s.w, 1, 1), idx(s.w, 2, 1), idx(s.w, 3, 1)], cross: [0, 4, 12] });
    expect(steer(contextOf(s), plan)).toEqual({ ok: true, dir: Dir.Right });
  });

  it.each([
    ['hard', false],
    ['easy', true],
  ] as const)('%s: a balloon landing further along the route (keeps going: %s)', (difficulty, keeps) => {
    // Regression (soak hard-ffa#2, seed 1760964653, round 11): two opponents dropped balloons on
    // either side of the bot's corridor in the same tick; the bot walked on to the tile between
    // them (and could never turn back) instead of turning round while its own balloon still let
    // it through.
    const s = stateFromAscii(['#######', '#0....#', '#.#.#.#', '#....1#', '#######'], { rules: CALM });
    putBalloon(s, 3, 1, 1, { fuse: 60, range: 1 });
    const plan = makePlan('go', { tiles: [idx(s.w, 1, 1), idx(s.w, 2, 1), idx(s.w, 3, 1), idx(s.w, 4, 1)], cross: [0, 4, 12, 20] });
    expect(steer(contextOf(s, difficulty), plan).ok).toBe(keeps);
  });
});

describe('careful checks', () => {
  it("time an opponent's first step from where it stands, not from its tile's centre", () => {
    // Regression (soak hard-ffa#1, seed 387509471, round 5): an opponent 0.4 tiles from the next
    // tile was taken to need a whole step to reach it, so a route through that tile did not count
    // as contested and the opponent sealed it three ticks after the bot's drop.
    const s = stateFromAscii(['#########', '#0.....1#', '#########'], { rules: CALM });
    s.players[1].x = tileCenter(5) - 300;
    const opp = opponentTicks(contextOf(s));
    const speed = speedUnitsPerTick(0);
    expect(opp[idx(s.w, 5, 1)]).toBe(0);
    expect(opp[idx(s.w, 4, 1)]).toBe(Math.ceil((CONFIG.SUB / 2 - 300) / speed));
    expect(opp[idx(s.w, 6, 1)]).toBe(Math.ceil((CONFIG.SUB / 2 + 300) / speed));
    expect(opp[idx(s.w, 3, 1)]).toBe(opp[idx(s.w, 4, 1)] + Math.ceil(CONFIG.SUB / speed));
  });

  it('see where a revenge duck could lob a balloon into its own cascade', () => {
    // Regression (soak lob-forced self-soaks): the bot hid right next to a landing tile of its own
    // cascade; a duck lobbed a balloon there at the last moment and its splash, bursting with the
    // bot's cascade, soaked the bot.
    const s = stateFromAscii(['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#...0...#', '#.......#', '#1......#', '#########'], {
      rules: { tide: false, revengeDucks: true },
    });
    Object.assign(s.players[1], { alive: false, duckPos: 4 * CONFIG.SUB, duckCooldownUntil: 0 });
    putBalloon(s, 4, 5, 0, { fuse: 60, range: 2 });
    const ctx = contextOf(s);
    const extra = lobbedSplashes(ctx, ctx.exact);
    // The top-side duck lands on (4,3), two tiles up the cascade's arm: (4,1) gets wet with it.
    expect(extra.get(idx(s.w, 4, 1))).toEqual([60, 60 + CONFIG.SPLASH_TICKS]);
    expect(extra.has(idx(s.w, 1, 1))).toBe(false);
  });

  it('route around tiles an opponent could block first', () => {
    const s = stateFromAscii(['#######', '#0....#', '#.###.#', '#.....#', '#######'], { rules: CALM });
    const ctx = contextOf(s);
    const target = idx(s.w, 5, 2);
    const enterBy = new Float64Array(s.w * s.h).fill(Infinity);
    enterBy[idx(s.w, 3, 1)] = 5;
    const spec = { danger: ctx.exact, blocked: ctx.blocked, mover: ctx.mover, startTick: 0, campUntil: 200, horizon: 200, margin: 1 };
    const direct = searchReach(spec).routeTo(target);
    const around = searchReach({ ...spec, enterBy }).routeTo(target);
    expect(direct?.tiles).toContain(idx(s.w, 3, 1));
    expect(around?.tiles).not.toContain(idx(s.w, 3, 1));
    expect(around?.tiles).toContain(idx(s.w, 3, 3));
  });
});
