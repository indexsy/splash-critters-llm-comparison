// Bot behaviour on small hand-made arenas: fleeing, never dropping without an escape, farming,
// never routing through its own splash when doomed, revenge ducks and determinism. The passive
// tutorial bot has its own file (bots-tutorial.test.ts).
import { describe, expect, it } from 'vitest';
import {
  Dir,
  Tile,
  createRoundState,
  generateMap,
  idx,
  makeRules,
  nearestDuckPos,
  simulateTick,
  tileOf,
  type GameEvent,
  type PlayerInput,
  type RoundState,
} from '@splash/shared';
import { createBot, type BotBrain } from '../src/bots/bot';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

/** Runs the bots (null = idle slot) for up to `ticks` ticks; returns every event. */
function run(s: RoundState, bots: (BotBrain | null)[], ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < ticks && !s.over; t++) {
    const inputs: (PlayerInput | null)[] = bots.map((b) => (b ? b.nextInput(s) : null));
    events.push(...simulateTick(s, inputs));
  }
  return events;
}

function placedBy(events: GameEvent[], slot: number): number {
  return events.filter((e) => e.type === 'balloon_placed' && e.owner === slot).length;
}

function soaked(events: GameEvent[], slot: number): boolean {
  return events.some((e) => e.type === 'player_soaked' && e.slot === slot);
}

const NO_TIDE = { rules: { tide: false, revengeDucks: false } };

describe('bots', () => {
  it.each(['easy', 'medium', 'hard'] as const)('%s flees from a balloon dropped next to it', (difficulty) => {
    const s = stateFromAscii(
      [
        '###########',
        '#.........#',
        '#.#.#.#.#.#',
        '#...0.....#',
        '#.#.#.#.#.#',
        '#........1#',
        '###########',
      ],
      NO_TIDE,
    );
    putBalloon(s, 5, 3, 1, { fuse: 40, range: 3 });
    const bot = createBot(0, difficulty, 11);
    const events = run(s, [bot, null], 70);
    // The splash covered the bot's starting tile (4,3): staying dry means it got out in time.
    const burst = events.find((e) => e.type === 'balloon_burst');
    expect(burst && burst.type === 'balloon_burst' ? burst.arms[2] : 0).toBeGreaterThanOrEqual(1);
    expect(soaked(events, 0)).toBe(false);
  });

  it.each(['easy', 'medium', 'hard'] as const)('%s never drops a balloon in a dead end with no escape', (difficulty) => {
    // Slot 0 sits at the bottom of a one-tile-wide dead end next to a castle; any balloon it drops
    // (range 2) would cover the whole corridor.
    const s = stateFromAscii(
      [
        '#######',
        '#.#####',
        '#.#####',
        '#0C####',
        '#######',
        '#....1#',
        '#######',
      ],
      NO_TIDE,
    );
    const bot = createBot(0, difficulty, 5);
    const events = run(s, [bot, null], 600);
    expect(placedBy(events, 0)).toBe(0);
    expect(s.players[0].alive).toBe(true);
    expect(s.tiles[idx(s.w, 2, 3)]).toBe(Tile.Castle);
  });

  it.each(['easy', 'medium', 'hard'] as const)('%s walks to a castle, washes it and stays dry', (difficulty) => {
    const s = stateFromAscii(
      [
        '###########',
        '#0........#',
        '#.#.#.#.#.#',
        '#.........#',
        '#.#.#.#.#C#',
        '#.........#',
        '###########',
        '#1........#',
        '###########',
      ],
      NO_TIDE,
    );
    const bot = createBot(0, difficulty, 3);
    const events = run(s, [bot, null], 900);
    const washed = events.filter((e) => e.type === 'castle_washed' && e.by === 0);
    expect(washed.map((e) => (e.type === 'castle_washed' ? [e.x, e.y] : []))).toEqual([[9, 4]]);
    expect(soaked(events, 0)).toBe(false);
  });

  it.each(['medium', 'hard'] as const)('%s never routes through its own splash when an opponent chain dooms its tile', (difficulty) => {
    // Regression (soak review): the bot's tile (8,7) turns wet through an opponent chain
    // ((11,9) sets off (11,7), whose splash runs along row 7). It used to pick a goal from there
    // with no route checks, hunting up column 9 inside its own balloon's splash, and the opponent
    // sealed it in by dropping at (11,5). Safe tiles (7,6) and (7,8) were two steps away.
    const s = stateFromAscii(
      [
        '#############',
        '#...........#',
        '#.#.#.#.#.#.#',
        '#...........#',
        '#.#.#.#.#.#.#',
        '#...........#',
        '#.#.#.#.#.#1#',
        '#.......0...#',
        '#.#.#.#.#.#.#',
        '#...........#',
        '#############',
      ],
      { rules: { tide: false, revengeDucks: false, sandbox: true } },
    );
    Object.assign(s.players[0], { range: 7, maxBalloons: 3 });
    Object.assign(s.players[1], { range: 4, maxBalloons: 5 });
    putBalloon(s, 9, 9, 0, { fuse: 31, range: 7 });
    putBalloon(s, 11, 9, 1, { fuse: 31, range: 4 });
    putBalloon(s, 11, 7, 1, { fuse: 87, range: 4 });
    const bot = createBot(0, difficulty, 13);
    let sealed = false;
    let inOwnColumn = false;
    const events: GameEvent[] = [];
    for (let t = 0; t < 140; t++) {
      // The opponent steps up to (11,5) and drops there, then stays.
      const opp = s.players[1];
      const drop: boolean = !sealed && tileOf(opp.y) === 5;
      sealed ||= drop;
      const input = { seq: t, dir: sealed || drop ? Dir.None : Dir.Up, balloon: drop };
      events.push(...simulateTick(s, [bot.nextInput(s), input]));
      const me = s.players[0];
      if (s.tick <= 31 && tileOf(me.x) === 9 && tileOf(me.y) < 9) inOwnColumn = true;
    }
    expect(sealed).toBe(true);
    expect(inOwnColumn).toBe(false);
    expect(events.some((e) => e.type === 'player_soaked' && e.slot === 0)).toBe(false);
  });

  it('rides its revenge duck and lobs at opponents once soaked (casual rules)', () => {
    const s = createRoundState(generateMap('ffa', 42), [true, true, true, true], makeRules({ ranked: false }));
    const me = s.players[0];
    me.alive = false;
    me.soakedTick = 0;
    me.duckPos = nearestDuckPos(s.w, s.h, me.x, me.y);
    me.duckCooldownUntil = 0;
    const bot = createBot(0, 'hard', 1);
    const start = me.duckPos;
    const events: GameEvent[] = [];
    let moved = false;
    for (let t = 0; t < 600 && !events.some((e) => e.type === 'revenge_lob'); t++) {
      events.push(...simulateTick(s, [bot.nextInput(s), null, null, null]));
      moved ||= me.duckPos !== start;
    }
    expect(moved).toBe(true);
    expect(events.some((e) => e.type === 'revenge_lob' && e.slot === 0)).toBe(true);
  });

  it('is deterministic: same seed and state give the same inputs, with increasing seq numbers', () => {
    const inputsOf = (): PlayerInput[] => {
      const s = createRoundState(generateMap('duel', 7), [true, true], makeRules({ ranked: false }));
      const bots = [createBot(0, 'hard', 99), createBot(1, 'easy', 98)];
      const out: PlayerInput[] = [];
      for (let t = 0; t < 900 && !s.over; t++) {
        const inputs = bots.map((b) => b.nextInput(s));
        out.push(inputs[0]);
        simulateTick(s, inputs);
      }
      return out;
    };
    const a = inputsOf();
    expect(inputsOf()).toEqual(a);
    expect(a.every((input, i) => i === 0 || input.seq > a[i - 1].seq)).toBe(true);
    expect(a.some((input) => input.balloon)).toBe(true);
  });

  it('idles on an empty or absent slot and after the round is over', () => {
    const s = createRoundState(generateMap('ffa', 3), [true, true, false, false], makeRules({ ranked: false }));
    const absent = createBot(2, 'medium', 1);
    expect(absent.nextInput(s)).toMatchObject({ dir: Dir.None, balloon: false });
    s.over = true;
    expect(createBot(0, 'hard', 1).nextInput(s)).toMatchObject({ dir: Dir.None, balloon: false });
  });
});
