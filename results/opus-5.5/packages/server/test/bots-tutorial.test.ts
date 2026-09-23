// The passive tutorial bot (sparring partner): it never drops a balloon, strolls around when
// nobody is near, flees a splash it has time to dodge, and a beginner can soak it quickly.
import { describe, expect, it } from 'vitest';
import {
  Dir,
  Tile,
  buildTutorialMap,
  computeArms,
  createRoundState,
  idx,
  isSolidFor,
  makeRules,
  simulateTick,
  splashTiles,
  tileOf,
  type DirCode,
  type GameEvent,
  type PlayerInput,
  type RoundState,
} from '@splash/shared';
import { createBot } from '../src/bots/bot';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

const STEPS: readonly [DirCode, number, number][] = [
  [Dir.Up, 0, -1],
  [Dir.Down, 0, 1],
  [Dir.Left, -1, 0],
  [Dir.Right, 1, 0],
];

/** First step of a shortest walk (avoiding `avoid` tiles) from the player's tile to a `goal` tile. */
function firstStep(s: RoundState, slot: number, goal: (tile: number) => boolean, avoid: ReadonlySet<number>): DirCode {
  const p = s.players[slot];
  const start = idx(s.w, tileOf(p.x), tileOf(p.y));
  if (goal(start)) return Dir.None;
  const first = new Map<number, DirCode>([[start, Dir.None]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const x = t % s.w;
    const y = (t - x) / s.w;
    for (const [dir, dx, dy] of STEPS) {
      const n = idx(s.w, x + dx, y + dy);
      if (first.has(n) || avoid.has(n) || isSolidFor(s, slot, x + dx, y + dy)) continue;
      first.set(n, t === start ? dir : first.get(t)!);
      if (goal(n)) return first.get(n)!;
      queue.push(n);
    }
  }
  return Dir.None;
}

/**
 * A beginner's plan: walk up to the bot, drop a balloon right next to it, step out of the
 * balloon's cross and wait for it to burst. Never walks into visible water.
 */
function beginner(slot: number, target: number): (s: RoundState) => PlayerInput {
  return (s) => {
    const me = s.players[slot];
    const bot = s.players[target];
    const here = idx(s.w, tileOf(me.x), tileOf(me.y));
    const water = new Set<number>();
    for (let i = 0; i < s.splashUntil.length; i++) if (s.splashUntil[i] > s.tick + 1) water.add(i);
    const cross = new Set(water);
    const mine = s.balloons.filter((b) => b.owner === slot);
    for (const b of mine) for (const t of splashTiles(b.tx, b.ty, computeArms(s, b.tx, b.ty, b.range))) cross.add(idx(s.w, t.x, t.y));
    if (mine.length > 0 || cross.has(here)) return { seq: 0, dir: firstStep(s, slot, (t) => !cross.has(t), water), balloon: false };
    const botTile = idx(s.w, tileOf(bot.x), tileOf(bot.y));
    const beside = Math.abs(tileOf(bot.x) - tileOf(me.x)) + Math.abs(tileOf(bot.y) - tileOf(me.y)) <= 1;
    if (bot.alive && beside) return { seq: 0, dir: Dir.None, balloon: true };
    return { seq: 0, dir: firstStep(s, slot, (t) => t === botTile, water), balloon: false };
  };
}

const tutorialRules = { ranked: false, tutorial: true };

describe('passive tutorial bot', () => {
  it('never drops a balloon and strolls around while nobody is near', () => {
    const s = createRoundState(buildTutorialMap(), [true, true], makeRules(tutorialRules));
    const bot = createBot(1, 'easy', 9, { passive: true });
    const cells = new Set<string>();
    const events: GameEvent[] = [];
    for (let t = 0; t < 1200; t++) {
      events.push(...simulateTick(s, [null, bot.nextInput(s)]));
      cells.add(`${tileOf(s.players[1].x)},${tileOf(s.players[1].y)}`);
    }
    expect(events.some((e) => e.type === 'balloon_placed')).toBe(false);
    expect(cells.size).toBeGreaterThan(3);
  });

  it('flees a splash it has time to dodge (one step out of the line)', () => {
    const s = stateFromAscii(['#########', '#.......#', '#.#.#.#.#', '#..1....#', '#.#.#.#.#', '#0......#', '#########'], {
      rules: { tide: false, revengeDucks: false, sandbox: true },
    });
    // The bot stands on the crossing (3,3); the balloon's splash covers row 3 and column 5.
    putBalloon(s, 5, 3, 0, { fuse: 40, range: 3 });
    const bot = createBot(1, 'easy', 4, { passive: true });
    const events: GameEvent[] = [];
    for (let t = 0; t < 70; t++) events.push(...simulateTick(s, [null, bot.nextInput(s)]));
    expect(events.some((e) => e.type === 'balloon_burst')).toBe(true);
    expect(events.some((e) => e.type === 'player_soaked')).toBe(false);
  });

  it('is soaked by a beginner who walks up and drops next to it, within a few tries', () => {
    const seconds: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      // The last lesson: the player has washed the arena's sandcastles by now. The player waits a
      // little (seed * 1.5 s) while the bot strolls somewhere, then goes after it.
      const s = createRoundState(buildTutorialMap(), [true, true], makeRules(tutorialRules));
      for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === Tile.Castle) s.tiles[i] = Tile.Floor;
      const bot = createBot(1, 'easy', seed, { passive: true });
      const player = beginner(0, 1);
      const start = seed * 45;
      let soakedAt = -1;
      for (let t = 0; t < start + 30 * 30 && soakedAt < 0; t++) {
        const input = t < start ? null : player(s);
        for (const e of simulateTick(s, [input, bot.nextInput(s)])) {
          expect(e.type === 'player_soaked' && e.slot === 0).toBe(false);
          if (e.type === 'player_soaked' && e.slot === 1 && e.by === 0) soakedAt = s.tick;
        }
      }
      expect(soakedAt).toBeGreaterThan(0);
      seconds.push((soakedAt - start) / 30);
    }
    seconds.sort((a, b) => a - b);
    expect(seconds[seconds.length >> 1]).toBeLessThan(15);
  });
});
