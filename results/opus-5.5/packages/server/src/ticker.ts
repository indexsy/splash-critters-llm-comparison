// The one global fixed-rate ticker (30 Hz) that drives every room, the matchmaker and pings.
// Ticks are scheduled on an absolute grid (start + k * period) so timer jitter never accumulates;
// after a stall it catches up at most `maxCatchUp` ticks and then drops the backlog instead of
// spiralling. Each tick receives its logical grid time.
import { CONFIG } from '@splash/shared';

/** Monotonic wall clock in epoch ms (immune to system clock jumps, comparable with Date.now()). */
export function serverClock(): number {
  return performance.timeOrigin + performance.now();
}

export interface TickerOptions {
  onTick: (now: number) => void;
  periodMs?: number;
  /** Most ticks run back-to-back when the loop fell behind. */
  maxCatchUp?: number;
  clock?: () => number;
  onError?: (err: unknown) => void;
}

export interface TickerStats {
  ticks: number;
  /** Ticks skipped because the process stalled longer than the catch-up window. */
  dropped: number;
}

export class Ticker {
  private readonly periodMs: number;
  private readonly maxCatchUp: number;
  private readonly clock: () => number;
  private nextAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly counters: TickerStats = { ticks: 0, dropped: 0 };

  constructor(private readonly opts: TickerOptions) {
    this.periodMs = opts.periodMs ?? CONFIG.TICK_MS;
    this.maxCatchUp = opts.maxCatchUp ?? 4;
    this.clock = opts.clock ?? serverClock;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get stats(): Readonly<TickerStats> {
    return this.counters;
  }

  start(): void {
    if (this.timer) return;
    this.nextAt = this.clock() + this.periodMs;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Runs every tick that is due at `now` (bounded), then drops any remaining backlog. */
  runDue(now: number): number {
    let ran = 0;
    while (now >= this.nextAt && ran < this.maxCatchUp) {
      this.fire(this.nextAt);
      this.nextAt += this.periodMs;
      ran++;
    }
    if (now >= this.nextAt) {
      const behind = Math.floor((now - this.nextAt) / this.periodMs) + 1;
      this.counters.dropped += behind;
      this.nextAt += behind * this.periodMs;
    }
    return ran;
  }

  private fire(at: number): void {
    this.counters.ticks++;
    try {
      this.opts.onTick(at);
    } catch (err) {
      if (this.opts.onError) this.opts.onError(err);
      else console.error('[ticker] tick failed', err);
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.runDue(this.clock());
      if (this.timer) this.schedule();
    }, Math.max(0, this.nextAt - this.clock()));
  }
}
