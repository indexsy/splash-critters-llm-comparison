// The tide end game (sudden death): only the innermost ring is safe to camp in once the
// second-to-last ring is about to flood, and a balloon that walls an opponent off from the
// innermost ring wins the round (the opponent drowns first).
import { describe, expect, it } from 'vitest';
import { CONFIG, Dir, simulateTick, tileOf, type GameEvent } from '@splash/shared';
import { createBot } from '../src/bots/bot';
import { campUntil, makeContext } from '../src/bots/context';
import { DangerMap } from '../src/bots/dangerMap';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

/** The tide rises from tick 30: ring 1 floods then, ring 2 on tick 75 and ring 3 (row 3, x 3..7) on tick 120. */
const TIDE = { tide: true, tideStartTick: 30, revengeDucks: false };
const SECOND_LAST_FLOOD = 30 + CONFIG.TIDE_INTERVAL_TICKS;
const LAST_FLOOD = 30 + 2 * CONFIG.TIDE_INTERVAL_TICKS;

function soakTick(events: { tick: number; e: GameEvent }[], slot: number): number {
  return events.find(({ e }) => e.type === 'player_soaked' && e.slot === slot)?.tick ?? -1;
}

describe('tide end game', () => {
  it('only counts the innermost ring as campable once the second-to-last ring is about to flood', () => {
    const s = stateFromAscii(['###########', '#.........#', '#.........#', '#....0....#', '#.........#', '#1........#', '###########'], {
      rules: TIDE,
    });
    const exact = DangerMap.fromState(s);
    const ctx = makeContext({ s, slot: 0, tuning: CONFIG.BOTS.hard, difficulty: 'hard', passive: false, rng: () => 0, exact, view: exact });
    const until = campUntil(ctx, 60);
    const ring2 = 2 * s.w + 5;
    const ring3 = 3 * s.w + 5;
    // Regression: a second-ring tile (dry until it floods) used to count as campable right up to
    // its flood, so bots idled there and drowned with the innermost ring free next to them.
    expect(exact.isDryBetween(ring2, 60, until)).toBe(false);
    expect(exact.isDryBetween(ring3, 60, until)).toBe(true);
  });

  it.each(['medium', 'hard'] as const)('%s moves into the innermost ring early and outlives the second-to-last flood', (difficulty) => {
    // The bot starts on (7,4), a second-ring tile; the idle opponent waits in the innermost ring.
    const s = stateFromAscii(['###########', '#.........#', '#.#.#.#.#.#', '#..1......#', '#.#.#.#0#.#', '#.........#', '###########'], {
      rules: TIDE,
    });
    const bot = createBot(0, difficulty, 21);
    const events: { tick: number; e: GameEvent }[] = [];
    let rowBeforeFlood = -1;
    for (let t = 0; t < LAST_FLOOD + 5 && !s.over; t++) {
      for (const e of simulateTick(s, [bot.nextInput(s), null])) events.push({ tick: s.tick, e });
      if (s.tick === SECOND_LAST_FLOOD - 20) rowBeforeFlood = tileOf(s.players[0].y);
    }
    expect(rowBeforeFlood).toBe(3);
    expect(soakTick(events, 0)).toBe(LAST_FLOOD);
  });

  it('walls an opponent off from the innermost ring so it drowns first', () => {
    // The opponent waits in a second-ring pocket at (5,2) whose only way into the innermost ring
    // is (5,3); it heads down there shortly before its pocket floods. A balloon on (5,3) keeps it
    // out; without one both would survive into the last ring and drown together.
    const s = stateFromAscii(['###########', '#.........#', '#.###1###.#', '#..0......#', '#.........#', '#.........#', '###########'], {
      rules: TIDE,
    });
    const bot = createBot(0, 'hard', 8);
    const events: { tick: number; e: GameEvent }[] = [];
    for (let t = 0; t < LAST_FLOOD + 5 && !s.over; t++) {
      const opponent = { seq: t + 1, dir: s.tick >= 60 ? Dir.Down : Dir.None, balloon: false };
      for (const e of simulateTick(s, [bot.nextInput(s), opponent])) events.push({ tick: s.tick, e });
    }
    const drop = events.find(({ e }) => e.type === 'balloon_placed' && e.owner === 0);
    expect(drop && drop.e.type === 'balloon_placed' ? [drop.e.x, drop.e.y] : null).toEqual([5, 3]);
    expect(soakTick(events, 1)).toBe(SECOND_LAST_FLOOD);
    expect(s.winner).toBe(0);
    expect(tileOf(s.players[1].y)).toBe(2);
  });

  it('keeps to a sudden-death escape whose refuge floods only after the opponent is soaked', () => {
    // Regression (soak hard-vs-easy#32, seed 2191338899, round 1): the duel arena at tick 3638,
    // tide level 1 (ring 2 floods on 3645, ring 3 on 3690, ring 4 on 3735, the centre row on
    // 3780). The Hard bot, walking down onto (7,5), traps the opponent in the dead end (7,6) with a
    // balloon (it bursts on 3729): its way out waits on (6,5) until the opponent's balloon on
    // (5,6) has splashed column 5 (3689..3700), then goes up to (5,4), dry until ring 4 floods on
    // 3735. The bot used to drop that plan at once (its refuge floods within the threat reflex)
    // and to fall back on the tile that stays dry longest from its EARLIEST reachable window,
    // which was the drop tile itself: it sat on its own balloon and took the opponent with it.
    const s = stateFromAscii(
      [
        '#############',
        '#...........#',
        '#.#.#.#.#.#.#',
        '#...........#',
        '#.#.#.#.#.#.#',
        '#......0....#',
        '#.#.#.#1#.#.#',
        '#...........#',
        '#.#.#.#.#.#.#',
        '#...........#',
        '#############',
      ],
      { rules: { tide: true, tideStartTick: CONFIG.TIDE_START_TICKS, revengeDucks: false } },
    );
    Object.assign(s, { tick: 3638, tideLevel: 1, nextTideTick: 3645 });
    Object.assign(s.players[0], { y: 16100, range: 3, maxBalloons: 4 });
    Object.assign(s.players[1], { y: 19700, range: 4, maxBalloons: 5 });
    putBalloon(s, 5, 6, 1, { fuse: 3689 - 3638, range: 4 });
    const bot = createBot(0, 'hard', 32);
    const events: { tick: number; e: GameEvent }[] = [];
    while (!s.over && s.tick < 3800) {
      for (const e of simulateTick(s, [bot.nextInput(s), null])) events.push({ tick: s.tick, e });
    }
    const drop = events.find(({ e }) => e.type === 'balloon_placed' && e.owner === 0);
    expect(drop && drop.e.type === 'balloon_placed' ? [drop.e.x, drop.e.y] : null).toEqual([7, 5]);
    expect(soakTick(events, 0)).toBe(-1);
    expect(s.winner).toBe(0);
  });
});
