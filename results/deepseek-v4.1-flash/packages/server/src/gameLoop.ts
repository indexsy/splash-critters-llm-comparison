export const TICK_MS = 1000 / 30;

export class GameLoop {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private accumulator = 0;
  private lastLagReport = 0;

  constructor(
    private readonly onTick: () => void,
    private readonly onLagged?: (elapsedMs: number) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.frame(), 8);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private frame(): void {
    const now = performance.now();
    let elapsed = now - this.last;
    this.last = now;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > 250) {
      if (this.onLagged && now - this.lastLagReport > 5000) {
        this.onLagged(elapsed);
        this.lastLagReport = now;
      }
      elapsed = 250;
    }
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= TICK_MS - 0.01 && steps < 5) {
      this.onTick();
      this.accumulator -= TICK_MS;
      steps += 1;
    }
    if (steps >= 5) this.accumulator = 0;
  }
}
