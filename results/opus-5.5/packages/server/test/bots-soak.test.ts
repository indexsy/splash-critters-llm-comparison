// The soak's judges: which self-soaks an opponent forced (attribution) and which bots froze.
// Scripted players on hand-made corridors make every scene exact and deterministic.
import { describe, expect, it } from 'vitest';
import {
  Dir,
  simulateTick,
  tileOf,
  type DirCode,
  type GameEvent,
  type PlayerInput,
  type RoundState,
} from '@splash/shared';
import type { BotBrain } from '../src/bots/bot';
import { forcedBy, hasWayOut, type RoundSource, type SelfSoak } from '../scripts/soak/attribution';
import { BalloonLog } from '../scripts/soak/balloonLog';
import { FREEZE_TICKS, FreezeWatch } from '../scripts/soak/freeze';
import { encodeInput } from '../scripts/soak/round';
import { putBalloon, stateFromAscii } from '../../shared/test/fixtures';

/** A brain driven by a pure function of the state (so replays behave identically). */
function scripted(slot: number, act: (s: RoundState) => { dir: DirCode; balloon?: boolean }): BotBrain {
  let seq = 0;
  return {
    slot,
    difficulty: 'hard',
    nextInput: (s) => ({ seq: ++seq, balloon: false, ...act(s) }),
    reset: () => undefined,
  };
}

/**
 * Corridor row 1 (x 1..6) with a side passage down column 3, where the opponent starts at (3,2).
 * The victim (0) drops a range-1 balloon at (1,1) on the first tick; it is safe from (3,1) on.
 */
const CORRIDOR = ['########', '#0.....#', '###1####', '###.####', '###.####', '########'];

function corridorStart(): RoundState {
  const s = stateFromAscii(CORRIDOR, { rules: { tide: false, revengeDucks: false } });
  s.players[0].range = 1;
  s.players[1].range = 1;
  return s;
}

const hasOwn = (s: RoundState, slot: number): boolean => s.balloons.some((b) => b.owner === slot);

/** Victim: drop at once, then run right (or stay put). */
function victim(runs: boolean): BotBrain {
  return scripted(0, (s) => (s.tick === 0 ? { dir: Dir.None, balloon: true } : { dir: runs ? Dir.Right : Dir.None }));
}

/** Opponent: walk up the side passage and drop on the corridor (3,1), then retreat down. */
const sealer = (): BotBrain =>
  scripted(1, (s) => {
    if (hasOwn(s, 1)) return { dir: Dir.Down };
    return tileOf(s.players[1].y) === 1 ? { dir: Dir.None, balloon: true } : { dir: Dir.Up };
  });

/** Opponent: walk up to the corridor, wait there until tick 40, then seal it at (3,1) and retreat down. */
const lateSealer = (): BotBrain =>
  scripted(1, (s) => {
    if (hasOwn(s, 1)) return { dir: Dir.Down };
    return tileOf(s.players[1].y) === 1 ? { dir: Dir.None, balloon: s.tick >= 40 } : { dir: Dir.Up };
  });

/** Opponent: walk down the side passage, away from the corridor, and drop there. */
const bystander = (): BotBrain =>
  scripted(1, (s) => ({ dir: Dir.Down, balloon: tileOf(s.players[1].y) === 4 && !hasOwn(s, 1) }));

interface Played {
  source: RoundSource;
  inputs: Uint8Array;
  selfSoaks: SelfSoak[];
}

/** Plays a scene (the corridor by default) like the soak does: records inputs and self-soak facts. */
function play(makeBrains: () => BotBrain[], ticks = 150, start: () => RoundState = corridorStart): Played {
  const source: RoundSource = { start };
  const s = source.start();
  const brains = makeBrains();
  const log = new BalloonLog();
  const inputs: number[] = [];
  const selfSoaks: SelfSoak[] = [];
  for (let t = 0; t < ticks && !s.over; t++) {
    const tick: (PlayerInput | null)[] = brains.map((b) => (b ? b.nextInput(s) : null));
    inputs.push(...tick.map(encodeInput));
    const events = simulateTick(s, tick);
    log.observe(s.tick, events);
    for (const e of events) {
      if (e.type === 'player_soaked' && e.by === e.slot) selfSoaks.push({ slot: e.slot, tick: s.tick, facts: log.factsOf(events, e, s.tick) });
    }
  }
  return { source, inputs: Uint8Array.from(inputs), selfSoaks };
}

describe('self-soak attribution', () => {
  it('forced: an opponent seals the only way out, and without that balloon the victim escapes', () => {
    const { source, inputs, selfSoaks } = play(() => [victim(true), sealer()]);
    expect(selfSoaks).toHaveLength(1);
    const [soak] = selfSoaks;
    expect(soak.facts.cut).toBe(1);
    expect(soak.facts.lastOpponentAction).toBeGreaterThanOrEqual(soak.facts.cut);
    expect(forcedBy(source, inputs, soak)).toBe('drop');
  });

  it('forced: a victim that stays put is sealed in just as early (running would not have saved it)', () => {
    const { source, inputs, selfSoaks } = play(() => [victim(false), sealer()]);
    expect(selfSoaks).toHaveLength(1);
    expect(forcedBy(source, inputs, selfSoaks[0])).toBe('drop');
  });

  it('unforced: a victim that dawdles until an opponent seals it in had time to get away', () => {
    const { source, inputs, selfSoaks } = play(() => [victim(false), lateSealer()]);
    expect(selfSoaks).toHaveLength(1);
    const [soak] = selfSoaks;
    expect(soak.facts.lastOpponentAction).toBeGreaterThanOrEqual(40);
    expect(forcedBy(source, inputs, soak)).toBeNull();
  });

  it('unforced: the victim still had a way out after the last opponent action', () => {
    const { source, inputs, selfSoaks } = play(() => [victim(false), bystander()]);
    expect(selfSoaks).toHaveLength(1);
    const [soak] = selfSoaks;
    expect(soak.facts.lastOpponentAction).toBeGreaterThan(soak.facts.cut);
    expect(forcedBy(source, inputs, soak)).toBeNull();
  });

  it('unforced: no opponent touched a balloon after the victim dropped', () => {
    const { source, inputs, selfSoaks } = play(() => [victim(false), scripted(1, () => ({ dir: Dir.None }))]);
    expect(selfSoaks[0].facts.lastOpponentAction).toBe(-1);
    expect(forcedBy(source, inputs, selfSoaks[0])).toBeNull();
  });

  it('replays opponent kicks from before the cut as recorded (only later ones are taken away)', () => {
    // Regression (soak crash): the counterfactual refused every opponent kick, even one made
    // before the victim's fatal drop, which the replay must reproduce as it happened. Here the
    // opponent kicks a balloon down row 3 at once, then drops one when the victim, sitting on its
    // own balloon at (1,1), can no longer get away.
    const start = (): RoundState => {
      const s = stateFromAscii(['#########', '#0......#', '#.#######', '#1......#', '#########'], { rules: { tide: false, revengeDucks: false } });
      s.players[0].range = 1;
      Object.assign(s.players[1], { range: 1, maxBalloons: 2, canKick: true });
      putBalloon(s, 2, 3, 1, { fuse: 200, range: 1 });
      return s;
    };
    const victim = scripted(0, (s) => ({ dir: Dir.None, balloon: s.tick === 20 }));
    const kicker = scripted(1, (s) => (s.tick === 0 ? { dir: Dir.Right } : { dir: Dir.None, balloon: s.tick === 105 }));
    const { source, inputs, selfSoaks } = play(() => [victim, kicker], 130, start);
    expect(selfSoaks).toHaveLength(1);
    const [soak] = selfSoaks;
    expect(soak.facts.lastOpponentAction).toBeGreaterThan(soak.facts.cut);
    expect(forcedBy(source, inputs, soak)).toBeNull();
  });

  it('keeps an opponent from kicking the balloon the victim drops in front of it that very tick', () => {
    // Regression (soak crash): the victim (slot 0, acting first) drops at (2,1) while the opponent
    // with Boots presses into (2,1) from (3,1); in the recording that kicked the new balloon along
    // the row. The counterfactual must stop the kick although no balloon was there before the tick.
    const start = (): RoundState => {
      const s = stateFromAscii(['########', '#.01...#', '###.####', '###.####', '########'], { rules: { tide: false, revengeDucks: false } });
      s.players[0].range = 1;
      Object.assign(s.players[1], { range: 1, canKick: true });
      return s;
    };
    const victim = scripted(0, (s) => ({ dir: Dir.None, balloon: s.tick === 20 }));
    // Presses left on tick 20 (kicking the fresh balloon to (1,1)), later seals the victim in with
    // a balloon of its own on (3,1) and leaves down the side passage.
    const kicker = scripted(1, (s) => {
      if (s.tick === 20) return { dir: Dir.Left };
      if (s.tick === 95) return { dir: Dir.None, balloon: true };
      return { dir: s.tick > 95 ? Dir.Down : Dir.None };
    });
    const { source, inputs, selfSoaks } = play(() => [victim, kicker], 130, start);
    expect(selfSoaks).toHaveLength(1);
    const [soak] = selfSoaks;
    expect(soak.facts.cut).toBe(21);
    expect(forcedBy(source, inputs, soak)).toBeNull();
  });

  it('hasWayOut sees a sealed pocket and an open corridor', () => {
    const open = corridorStart();
    putBalloon(open, 1, 1, 0, { fuse: 40, range: 1 });
    expect(hasWayOut(open, 0)).toBe(true);
    const sealed = corridorStart();
    putBalloon(sealed, 1, 1, 0, { fuse: 40, range: 1 });
    putBalloon(sealed, 2, 1, 1, { fuse: 80, range: 1 });
    expect(hasWayOut(sealed, 0)).toBe(false);
  });
});

describe('freeze watch', () => {
  // A castle at (6,1) is always reachable: there is work to do. Slot 1 idles far away.
  const ROOM = ['########', '#0....C#', '#.#.#..#', '#......#', '#.....1#', '########'];

  /** The freeze events of slot 0 driven by `act`. */
  function watch(act: (s: RoundState) => DirCode, ticks: number, each?: (s: RoundState) => void): FreezeWatch['events'] {
    const s = stateFromAscii(ROOM, { rules: { tide: false, revengeDucks: false } });
    const w = new FreezeWatch(s);
    const brain = scripted(0, (st) => ({ dir: act(st) }));
    for (let t = 0; t < ticks; t++) {
      each?.(s);
      const events: GameEvent[] = simulateTick(s, [brain.nextInput(s), null]);
      expect(events.some((e) => e.type === 'player_soaked')).toBe(false);
      w.observe(s);
    }
    return w.events.filter((e) => e.slot === 0);
  }

  /** Walks right for 10 ticks, left for 10, forever: shuttles between (1,1) and (2,1). */
  const shuttle = (s: RoundState): DirCode => (Math.floor(s.tick / 10) % 2 === 0 ? Dir.Right : Dir.Left);

  it('flags a bot shuttling between two tiles (it moves every tick, yet makes no progress)', () => {
    const events = watch(shuttle, FREEZE_TICKS + 40);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ slot: 0, reason: 'castle' });
  });

  it('does not flag a bot that keeps making progress', () => {
    const lap = (s: RoundState): DirCode => (Math.floor(s.tick / 60) % 2 === 0 ? Dir.Right : Dir.Left);
    expect(watch(lap, FREEZE_TICKS * 2)).toHaveLength(0);
  });

  it('does not count time spent dodging next to pending splashes', () => {
    // Balloons always wait on (1,3) and (3,3): their splashes reach (1,2) and (3,1), next to both
    // tiles of the shuttle (which never steps into them).
    const keepThreat = (s: RoundState): void => {
      if (s.balloons.length === 0) {
        putBalloon(s, 1, 3, 1, { fuse: 60, range: 1 });
        putBalloon(s, 3, 3, 1, { fuse: 60, range: 2 });
      }
    };
    expect(watch(shuttle, FREEZE_TICKS * 2, keepThreat)).toHaveLength(0);
  });
});
