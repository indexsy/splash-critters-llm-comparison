// Lifecycle bag for a mounted screen or dialog: every timer, subscription and animation loop is
// registered here, and one dispose() releases them all (in reverse order) on unmount.

export class Scope {
  private disposers: (() => void)[] = [];
  private disposed = false;

  /** Register a cleanup function (runs immediately if the scope is already disposed). */
  add(dispose: () => void): void {
    if (this.disposed) {
      dispose();
      return;
    }
    this.disposers.push(dispose);
  }

  interval(fn: () => void, ms: number): void {
    const id = window.setInterval(fn, ms);
    this.add(() => window.clearInterval(id));
  }

  timeout(fn: () => void, ms: number): void {
    const id = window.setTimeout(fn, ms);
    this.add(() => window.clearTimeout(id));
  }

  /**
   * requestAnimationFrame loop until disposed, or until `fn` returns false (an animation that has
   * settled stops asking for frames). `fn` gets the frame timestamp (ms).
   */
  loop(fn: (now: number) => boolean | void): void {
    let id = 0;
    const tick = (now: number) => {
      id = requestAnimationFrame(tick);
      if (fn(now) === false) cancelAnimationFrame(id);
    };
    id = requestAnimationFrame(tick);
    this.add(() => cancelAnimationFrame(id));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const fn of this.disposers.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        console.error('[screens] cleanup failed', err);
      }
    }
  }
}
