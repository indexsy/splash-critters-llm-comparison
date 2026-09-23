// Pure SFX admission control: caps concurrent voices, rate-limits identical sounds and
// picks which playing voice to steal. Generic over the voice handle so it runs under Node.

export type Admission<T> =
  | { admit: true; evict: T | null }
  | { admit: false; reason: 'repeat' | 'full' };

interface Entry<T> {
  name: string;
  priority: number;
  handle: T;
}

export class VoicePool<T> {
  /** Playing voices in start order (oldest first). */
  private readonly entries: Entry<T>[] = [];
  private readonly lastStart = new Map<string, number>();

  constructor(
    readonly maxVoices: number,
    readonly repeatWindowMs: number,
  ) {}

  get size(): number {
    return this.entries.length;
  }

  /**
   * Decide whether a new sound may start. When the pool is full the oldest voice with
   * priority <= `priority` is evicted (removed here; the caller must silence it).
   */
  request(name: string, priority: number, nowMs: number): Admission<T> {
    const last = this.lastStart.get(name);
    if (last !== undefined && nowMs - last < this.repeatWindowMs) return { admit: false, reason: 'repeat' };
    if (this.entries.length < this.maxVoices) return { admit: true, evict: null };
    const victim = this.entries.findIndex((e) => e.priority <= priority);
    if (victim < 0) return { admit: false, reason: 'full' };
    const [evicted] = this.entries.splice(victim, 1);
    return { admit: true, evict: evicted.handle };
  }

  /** Record a voice that was admitted by `request`. */
  add(name: string, priority: number, nowMs: number, handle: T): void {
    this.entries.push({ name, priority, handle });
    this.lastStart.set(name, nowMs);
  }

  /** Forget a finished (or stolen) voice. Safe to call more than once. */
  release(handle: T): void {
    const i = this.entries.findIndex((e) => e.handle === handle);
    if (i >= 0) this.entries.splice(i, 1);
  }
}
