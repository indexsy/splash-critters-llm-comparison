// Practice targets that never attack, for measuring how well Hard hunts: the "wanderer" is the
// passive tutorial sparring partner (strolls around, flees a splash only at the last moment) and
// the "statue" never moves at all.
import { Dir, type PlayerInput, type RoundState } from '@splash/shared';
import { createBot, type BotBrain } from '../../src/bots/bot';

export type Dummy = 'wanderer' | 'statue';

/** A brain that stands still and never drops a balloon. */
class Statue implements BotBrain {
  readonly difficulty = 'easy';
  private seq = 0;

  constructor(readonly slot: number) {}

  nextInput(_state: RoundState): PlayerInput {
    return { seq: ++this.seq, dir: Dir.None, balloon: false };
  }

  reset(): void {
    this.seq = 0;
  }
}

export function createDummy(kind: Dummy, slot: number, seed: number): BotBrain {
  return kind === 'statue' ? new Statue(slot) : createBot(slot, 'easy', seed, { passive: true });
}
