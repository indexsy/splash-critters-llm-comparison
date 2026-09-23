// Hard's kicks: the kick must be timed exactly like the sim, which kicks within the very tick the
// player's move leaves it clamped in front of the balloon (lane re-centering included).
import { describe, expect, it } from 'vitest';
import { CONFIG, Dir, idx, simulateTick, type RoundState } from '@splash/shared';
import { makeContext } from '../src/bots/context';
import { DangerMap } from '../src/bots/dangerMap';
import { findKick } from '../src/bots/kick';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

/**
 * A dead-end column: the opponent (1) at its top, lingering water on (1,3), the bot's balloon on
 * (1,4) and the bot (0) on (1,5), 240 sub-units left of its lane, with a way out to the right.
 * Kicked up, the balloon slides across (1,3) and stops on (1,2), in front of the trapped
 * opponent; if it enters (1,3) while the water is still there it bursts on the spot, and its
 * splash reaches the bot.
 */
function scene(waterFor: number, fuse = 80): RoundState {
  const s = stateFromAscii(['#####', '#1###', '#.###', '#.###', '#.###', '#0..#', '#####'], { rules: { tide: false, revengeDucks: false } });
  const me = s.players[0];
  me.canKick = true;
  me.x -= 240;
  putBalloon(s, 1, 4, 0, { fuse, range: 2 }).passMask = 0;
  const water = idx(s.w, 1, 3);
  s.splashUntil[water] = s.tick + waterFor;
  s.splashOwner[water] = 1;
  return s;
}

function kickOf(s: RoundState): ReturnType<typeof findKick> {
  const exact = DangerMap.fromState(s);
  return findKick(makeContext({ s, slot: 0, tuning: CONFIG.BOTS.hard, difficulty: 'hard', passive: false, rng: () => 0, exact, view: exact }));
}

describe('kicks', () => {
  it('traps an opponent in a dead end once the water ahead has drained', () => {
    const s = scene(1);
    expect(kickOf(s)).toMatchObject({ dir: Dir.Up });
    // Pressing up re-centers the bot and kicks on the very first tick.
    const events = simulateTick(s, [{ seq: 1, dir: Dir.Up, balloon: false }, null]);
    expect(events.some((e) => e.type === 'balloon_kicked' && e.slot === 0)).toBe(true);
  });

  it('never kicks unless it could still get away if the kick failed (someone stepping into the slide)', () => {
    // Regression (soak): a kick blocked at the last moment left the bot pressing into a balloon
    // about to burst. With 12 ticks left, a bot still pressing when the kick fails is too late.
    expect(kickOf(scene(0, 12))).toBeNull();
    expect(kickOf(scene(0, 40))).toMatchObject({ dir: Dir.Up });
  });

  it('never kicks its balloon into water it would still reach (it would burst on top of the bot)', () => {
    // Regression (soak): the kick was assumed to happen one tick after the bot re-centers, so the
    // balloon was expected to reach the water a tick after it drained; it burst in it instead.
    const s = scene(3);
    expect(kickOf(s)).toBeNull();
  });
});
