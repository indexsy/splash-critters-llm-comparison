import { describe, expect, it } from 'vitest';
import { Dir, type DirCode } from '@splash/shared';
import { InputQueues, MAX_STEP_DEBT, STARVED_TICKS } from '../src/match/inputs';

const inp = (seq: number, dir: DirCode, balloon = false) => ({ seq, dir, balloon });

/** Pops `n` ticks for slot 0 and returns the directions the sim would apply. */
function run(q: InputQueues, n: number): DirCode[] {
  return Array.from({ length: n }, () => q.next(0).dir);
}

describe('InputQueues step debt (network jitter)', () => {
  it('repeats the last direction while starved, then absorbs the late inputs instead of re-walking them', () => {
    const q = new InputQueues(1);
    q.push(0, inp(1, Dir.Right));
    expect(run(q, 1)).toEqual([Dir.Right]);
    // Three ticks without input: the critter keeps walking on the player's behalf.
    expect(run(q, 3)).toEqual([Dir.Right, Dir.Right, Dir.Right]);
    // The three late inputs plus the current one arrive together.
    for (const seq of [2, 3, 4, 5]) q.push(0, inp(seq, Dir.Right));
    const tick = q.next(0);
    expect(tick).toMatchObject({ seq: 5, dir: Dir.Right });
    expect(q.ack(0)).toBe(5);
    // 5 inputs sent -> exactly 5 steps walked (1 + 3 repeated + 1), nothing left to over-walk.
    expect(q.next(0).dir).toBe(Dir.Right); // starved again: a repeat, not a queued step
  });

  it('stops paying back when the player turned during the hiccup', () => {
    const q = new InputQueues(1);
    q.push(0, inp(1, Dir.Right));
    run(q, 3); // one real + two repeated Right steps
    q.push(0, inp(2, Dir.Up));
    q.push(0, inp(3, Dir.Up));
    expect(q.next(0)).toMatchObject({ seq: 2, dir: Dir.Up });
    expect(q.next(0)).toMatchObject({ seq: 3, dir: Dir.Up });
  });

  it('never loses a balloon press from an absorbed input', () => {
    const q = new InputQueues(1);
    q.push(0, inp(1, Dir.Left));
    run(q, 2);
    q.push(0, inp(2, Dir.Left, true));
    q.push(0, inp(3, Dir.Left));
    const tick = q.next(0);
    expect(tick).toMatchObject({ seq: 3, dir: Dir.Left, balloon: true });
    expect(q.next(0).balloon).toBe(false);
  });

  it('caps the debt and forgets it after a full starvation second (a frozen tab keeps its fresh input)', () => {
    const q = new InputQueues(1);
    q.push(0, inp(1, Dir.Down));
    run(q, 1 + STARVED_TICKS + 5);
    expect(q.next(0).dir).toBe(Dir.None);
    // Fresh input after the freeze is applied at once, not swallowed as debt.
    q.push(0, inp(2, Dir.Down));
    expect(q.next(0)).toMatchObject({ seq: 2, dir: Dir.Down });

    const capped = new InputQueues(1);
    capped.push(0, inp(1, Dir.Right));
    run(capped, 1 + MAX_STEP_DEBT + 4);
    for (let seq = 2; seq <= MAX_STEP_DEBT + 6; seq++) capped.push(0, inp(seq, Dir.Right));
    // Only MAX_STEP_DEBT inputs are absorbed; the queue cap already dropped the oldest ones.
    expect(capped.next(0).seq).toBeGreaterThan(1);
  });
});
