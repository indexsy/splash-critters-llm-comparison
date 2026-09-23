// Following a plan tick by tick: the bot re-plans at once when new danger floods a tile of its
// route while the plan has it there, and follows a route that leaves a tile on the very tick it
// turns wet (moves come before bursts within a tick).
import { describe, expect, it } from 'vitest';
import { CONFIG, Dir, idx, type RoundState } from '@splash/shared';
import { makeContext, type BotContext } from '../src/bots/context';
import { DangerMap } from '../src/bots/dangerMap';
import { makePlan, steer } from '../src/bots/steer';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

/** The bot (0) on (3,1); a balloon on (5,1) splashes row 1 from tick 8 on. */
function scene(): RoundState {
  const s = stateFromAscii(['#######', '#..0..#', '#.#.#.#', '#.....#', '#1....#', '#######'], { rules: { tide: false, revengeDucks: false } });
  putBalloon(s, 5, 1, 1, { fuse: 8, range: 4 });
  return s;
}

function contextOf(s: RoundState): BotContext {
  const exact = DangerMap.fromState(s);
  return makeContext({ s, slot: 0, tuning: CONFIG.BOTS.hard, difficulty: 'hard', passive: false, rng: () => 0, exact, view: exact });
}

describe('steering', () => {
  const here = (s: RoundState): number => idx(s.w, 3, 1);
  const below = (s: RoundState): number => idx(s.w, 3, 2);

  it('follows a route that leaves a tile on the tick it turns wet', () => {
    // Regression: the new-danger reflex demanded a spare tick, so the zero-margin escapes of a
    // bot with no time to spare were re-planned every tick and never taken.
    const s = scene();
    const plan = makePlan('escape', { tiles: [here(s), below(s)], cross: [0, 8] });
    expect(steer(contextOf(s), plan)).toEqual({ ok: true, dir: Dir.Down });
  });

  it('re-plans at once when new danger floods its tile before the plan leaves it', () => {
    const s = scene();
    const plan = makePlan('escape', { tiles: [here(s), below(s)], cross: [0, 9] });
    expect(steer(contextOf(s), plan)).toMatchObject({ ok: false, reason: 'threatened' });
  });

  it('re-plans at once when new danger floods a later tile of the route while it is there', () => {
    const s = scene();
    const plan = makePlan('go', { tiles: [here(s), idx(s.w, 2, 1), idx(s.w, 1, 1), idx(s.w, 1, 2)], cross: [0, 4, 12, 20] });
    expect(steer(contextOf(s), plan)).toMatchObject({ ok: false, reason: 'threatened' });
  });
});
