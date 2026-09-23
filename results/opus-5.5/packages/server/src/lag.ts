// Artificial latency (DEV_LAG_MS): a FIFO that runs callbacks a fixed delay after they were
// queued, strictly in queue order. With a zero delay callbacks run synchronously, so production
// pays nothing for it.

/** Upper bound for DEV_LAG_MS: anything larger is a typo, not a latency test. */
const MAX_DEV_LAG_MS = 5000;

/** Parses DEV_LAG_MS: a non-negative integer number of ms (clamped), 0 when unset or invalid. */
export function parseLagMs(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_DEV_LAG_MS, Math.round(n)) : 0;
}

export class DelayLine {
  private queue: { due: number; run: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  push(run: () => void): void {
    if (this.delayMs <= 0) {
      run();
      return;
    }
    this.queue.push({ due: this.clock() + this.delayMs, run });
    if (!this.timer) this.arm();
  }

  /** Drops everything still waiting (the socket closed). */
  clear(): void {
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    const head = this.queue[0];
    if (!head) return;
    this.timer = setTimeout(() => this.drain(), Math.max(0, head.due - this.clock()));
  }

  private drain(): void {
    this.timer = null;
    const now = this.clock();
    while (this.queue.length > 0 && this.queue[0].due <= now) {
      const item = this.queue.shift()!;
      try {
        item.run();
      } catch (err) {
        console.error('[lag] delayed task failed', err);
      }
    }
    this.arm();
  }
}
