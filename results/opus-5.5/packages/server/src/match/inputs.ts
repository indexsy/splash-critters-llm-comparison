// Per-player input FIFOs. Clients send one input per client tick; the server pops one per sim
// tick. Seq must strictly increase (replays / reordering are ignored), the queue holds at most
// SERVER_INPUT_QUEUE_MAX (oldest dropped, but a dropped balloon press carries over so it is never
// lost), and an empty queue repeats the last direction without a press, bridging jitter; after
// STARVED_TICKS without any input the player stops (frozen client or a dead connection).
//
// Every repeated movement tick is a step the client did not send yet: when the late inputs for
// that same direction arrive, they are absorbed (acknowledged, their presses carried forward)
// instead of walked again, so jitter never makes a critter over-walk its prediction.
import { CONFIG, Dir, type DirCode, type PlayerInput } from '@splash/shared';

/** One second of sim ticks with an empty queue: the critter stops walking. */
export const STARVED_TICKS = CONFIG.TICK_RATE;
/** Repeated steps remembered for absorption: a jitter burst, not a frozen tab (see header). */
export const MAX_STEP_DEBT = CONFIG.SERVER_INPUT_QUEUE_MAX;

interface PlayerQueue {
  queue: PlayerInput[];
  /** Highest seq accepted so far (-1 = none). */
  lastSeq: number;
  /** Seq of the last input applied to the sim (sent back as snapshot.ack). */
  ack: number;
  lastDir: DirCode;
  /** Consecutive ticks the queue was empty. */
  emptyTicks: number;
  /** Movement ticks repeated on the player's behalf that late inputs have not yet paid back. */
  stepDebt: number;
  /** A balloon press from an absorbed input, applied on the next tick. */
  carryBalloon: boolean;
}

function emptyQueue(): PlayerQueue {
  return { queue: [], lastSeq: -1, ack: 0, lastDir: Dir.None, emptyTicks: 0, stepDebt: 0, carryBalloon: false };
}

/** Late inputs repeating the direction already walked on their behalf are acknowledged, not re-walked. */
function absorbStepDebt(q: PlayerQueue): void {
  while (q.stepDebt > 0 && q.queue.length > 0) {
    const head = q.queue[0];
    if (head.dir !== q.lastDir) {
      // The player turned: the repeated steps were a guess that reconciliation corrects.
      q.stepDebt = 0;
      return;
    }
    q.queue.shift();
    q.stepDebt--;
    q.ack = head.seq;
    if (head.balloon) q.carryBalloon = true;
  }
}

export class InputQueues {
  private readonly players: PlayerQueue[];

  constructor(
    slots: number,
    private readonly maxQueued: number = CONFIG.SERVER_INPUT_QUEUE_MAX,
  ) {
    this.players = Array.from({ length: slots }, emptyQueue);
  }

  /** Queues an input; returns false when it was ignored (unknown slot or seq not increasing). */
  push(slot: number, input: PlayerInput): boolean {
    const q = this.players[slot];
    if (!q || input.seq <= q.lastSeq) return false;
    q.lastSeq = input.seq;
    q.queue.push({ seq: input.seq, dir: input.dir, balloon: input.balloon });
    while (q.queue.length > this.maxQueued) {
      const dropped = q.queue.shift()!;
      if (dropped.balloon) q.queue[0].balloon = true;
    }
    return true;
  }

  /**
   * This tick's input: the oldest queued one (after paying back repeated steps), else the last
   * direction (until starved) with no new press.
   */
  next(slot: number): PlayerInput {
    const q = this.players[slot];
    absorbStepDebt(q);
    const input = q.queue.shift();
    const carried = q.carryBalloon;
    q.carryBalloon = false;
    if (!input) {
      if (++q.emptyTicks >= STARVED_TICKS) {
        q.lastDir = Dir.None;
        q.stepDebt = 0;
      }
      if (q.lastDir !== Dir.None) q.stepDebt = Math.min(MAX_STEP_DEBT, q.stepDebt + 1);
      return { seq: q.ack, dir: q.lastDir, balloon: carried };
    }
    q.emptyTicks = 0;
    q.ack = input.seq;
    q.lastDir = input.dir;
    return carried ? { ...input, balloon: true } : input;
  }

  ack(slot: number): number {
    return this.players[slot]?.ack ?? 0;
  }

  /** The player went idle (disconnected / replaced): forget queued inputs and stop moving. */
  idle(slot: number): void {
    const q = this.players[slot];
    if (!q) return;
    q.queue = [];
    q.lastDir = Dir.None;
    q.stepDebt = 0;
    q.carryBalloon = false;
  }

  /** A re-attached client may restart its seq counter: accept anything again. */
  resetSeq(slot: number): void {
    const q = this.players[slot];
    if (!q) return;
    this.idle(slot);
    q.lastSeq = -1;
    q.ack = 0;
  }

  /** Round boundary: nothing carries over between rounds. */
  idleAll(): void {
    for (let slot = 0; slot < this.players.length; slot++) this.idle(slot);
  }
}
