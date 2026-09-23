// Paces the local player's 30 Hz inputs off frame deltas: how many client ticks a frame runs,
// what happens to latched presses while the player cannot act, and the step phase the local
// critter is drawn ahead with.
import { FixedStep } from './clock';

/** The latched presses the pacer manages (input.ts in the game, a fake in tests). */
export interface PressLatches {
  consumeDirPress(): boolean;
  clearLatches(): void;
}

/**
 * Whether the local player may send inputs this frame: 'act' yes; 'hold' not yet, but presses
 * made now are kept for the first tick ("SPLASH!" until the server's first tick); 'drop' no,
 * and presses made now are dropped (the 3-2-1, soaked without a duck, offline) so they never
 * fire a phantom balloon later.
 */
export type InputGate = 'act' | 'hold' | 'drop';

export class InputPacer {
  private readonly step = new FixedStep();
  /** The previous frame could act (a frame that newly can runs a tick at once). */
  private acting = false;

  constructor(private readonly latches: PressLatches) {}

  /**
   * Client ticks to run this frame. The first frame able to act runs a tick right away and the
   * tick schedule starts from it: the round's first input leaves the moment the server takes
   * inputs, not up to a tick later. A fresh direction press pulls the next tick ahead instead
   * (see FixedStep.pullForward), so the long-run input rate is unchanged.
   */
  ticksDue(gate: InputGate, dtMs: number): number {
    if (gate !== 'act') {
      if (gate === 'drop') this.latches.clearLatches();
      this.reset();
      return 0;
    }
    const pressed = this.latches.consumeDirPress();
    if (!this.acting) {
      this.acting = true;
      this.step.reset();
      return 1;
    }
    let steps = this.step.advance(dtMs);
    if (pressed && steps === 0 && this.step.pullForward()) steps = 1;
    return steps;
  }

  /** How far (0..1) the time since the last tick has progressed toward the next one. */
  phase(): number {
    return this.step.phase();
  }

  /** Nothing carried over (a new round, or a frame that cannot act). */
  reset(): void {
    this.step.reset();
    this.acting = false;
  }
}
