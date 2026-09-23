// Client-side time keeping for a round: the 30 Hz fixed-step input clock (driven by
// requestAnimationFrame deltas), the server tick estimate used for fuses and input stamps, and
// the 3-2-1 intro phases derived from round_start.startTime.
import { CONFIG } from '@splash/shared';

/**
 * Fixed-step accumulator: feed it frame deltas, it answers how many whole steps are due.
 * A long stall (hidden tab, debugger) runs at most `maxSteps` catch-up steps, then drops the
 * rest instead of flooding the server with a burst of stale inputs.
 */
export class FixedStep {
  private acc = 0;
  /** Accumulator value the current step interval started from (below 0 after a pull). */
  private from = 0;

  constructor(
    private readonly stepMs: number = CONFIG.TICK_MS,
    private readonly maxSteps = 4,
  ) {}

  advance(dtMs: number): number {
    this.acc += Math.max(0, dtMs);
    if (this.acc < this.stepMs) return 0;
    let steps = Math.floor(this.acc / this.stepMs);
    this.acc -= steps * this.stepMs;
    this.from = 0;
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.acc = 0;
    }
    return steps;
  }

  /** How far (0..1) the time since the last step has progressed toward the next one. */
  phase(): number {
    const span = this.stepMs - this.from;
    return span > 0 ? Math.min(1, Math.max(0, (this.acc - this.from) / span)) : 0;
  }

  /**
   * Run the next scheduled step right now instead (a fresh key press should move the critter on
   * the very next frame, not up to a whole tick later). The step it replaces is skipped, so the
   * number of steps over time, and with it the input rate the server expects, is unchanged.
   * At most one step can be pulled ahead: returns false while one already is.
   */
  pullForward(): boolean {
    if (this.acc < 0) return false;
    this.acc -= this.stepMs;
    this.from = this.acc;
    return true;
  }

  reset(): void {
    this.acc = 0;
    this.from = 0;
  }
}

/** A server tick known to have happened at a given server time. */
export interface TickAnchor {
  tick: number;
  serverTime: number;
}

/** Continuous server tick at `serverNow`, extrapolated from an anchor. */
function estimateServerTick(anchor: TickAnchor, serverNow: number): number {
  return anchor.tick + (serverNow - anchor.serverTime) / CONFIG.TICK_MS;
}

/** A backwards jump larger than this is a real resync (new anchor), not snapshot jitter. */
const RESYNC_TICKS = 10;

/**
 * Server tick estimate for rendering fuses and stamping inputs. Anchored at round start
 * (tick 0 at startTime, or resumeTick on a reconnect) and re-anchored by every snapshot.
 * Small backwards corrections from jittery snapshots are ignored so fuses never rewind.
 */
export class TickEstimator {
  private anchor: TickAnchor = { tick: 0, serverTime: 0 };
  private last = -Infinity;

  /** Start of a round: tick `tick` happens at server time `serverTime`. */
  reset(anchor: TickAnchor): void {
    this.anchor = anchor;
    this.last = -Infinity;
  }

  /** A snapshot of tick `tick` was stamped at `serverTime`. */
  observe(anchor: TickAnchor): void {
    this.anchor = anchor;
  }

  /** Estimated (fractional) server tick at `serverNow`, never below 0. */
  now(serverNow: number): number {
    const est = Math.max(0, estimateServerTick(this.anchor, serverNow));
    if (est >= this.last || est < this.last - RESYNC_TICKS) this.last = est;
    return this.last;
  }

  /** The (fractional) tick at any server time, e.g. the remote render time (no jitter guard). */
  at(serverTime: number): number {
    return estimateServerTick(this.anchor, serverTime);
  }
}

/**
 * Where a round_start puts the tick estimate. The server re-sends round_start with its current
 * tick on every re-attach, also during the 3-2-1, when that tick is still 0 (tick 1 is only
 * simulated one period after startTime). Only a resumeTick above 0 re-attaches mid-round
 * (anchored at arrival, no countdown); anything else is a normal start anchored at startTime.
 */
export function roundStartAnchor(rs: { startTime: number; resumeTick?: number }, serverNow: number): { anchor: TickAnchor; resumed: boolean } {
  const tick = rs.resumeTick ?? 0;
  if (tick > 0) return { anchor: { tick, serverTime: serverNow }, resumed: true };
  return { anchor: { tick: 0, serverTime: rs.startTime }, resumed: false };
}

export type IntroPhase =
  | { kind: 'count'; n: number; /** ms elapsed since this number appeared */ elapsed: number }
  | { kind: 'go'; elapsed: number }
  | { kind: 'none' };

/** How long "SPLASH!" stays up from startTime (tick 0). */
const GO_SHOW_MS = 800;

/** Countdown phase at `serverNow` for a round whose tick 0 is at `startTime`. */
export function introPhase(serverNow: number, startTime: number): IntroPhase {
  const left = startTime - serverNow;
  if (left > 0) {
    const n = Math.ceil(left / 1000);
    if (n > 3) return { kind: 'none' };
    return { kind: 'count', n, elapsed: n * 1000 - left };
  }
  if (-left < GO_SHOW_MS) return { kind: 'go', elapsed: -left };
  return { kind: 'none' };
}

/**
 * Headroom past the server's first tick: its ticker fires a little after the grid time it
 * stands for, and startTime travels rounded to the millisecond.
 */
const GO_LIVE_SLACK_MS = 5;

/**
 * Server time the round goes live: its first tick has happened and inputs may be sent. The
 * server simulates tick 1 one period after startTime (tick 0) and rejects every input that
 * reaches it before then, so an input sent at "SPLASH!" itself would be predicted, then lost.
 */
export function roundLiveAt(startTime: number): number {
  return startTime + CONFIG.TICK_MS + GO_LIVE_SLACK_MS;
}

/** True once the round is live (see roundLiveAt). */
export function isRoundLive(serverNow: number, startTime: number): boolean {
  return serverNow >= roundLiveAt(startTime);
}

/**
 * True from "SPLASH!" (startTime) until the round goes live: a press made now is kept for the
 * first input instead of being dropped like a press during the 3-2-1.
 */
export function isGoWindow(serverNow: number, startTime: number): boolean {
  return serverNow >= startTime && !isRoundLive(serverNow, startTime);
}
