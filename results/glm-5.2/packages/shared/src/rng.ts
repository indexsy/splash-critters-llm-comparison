// rng.ts — seeded PRNG (mulberry32). Deterministic; identical seed => identical sequence.

export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normalize to uint32
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9; // avoid degenerate zero state
  }

  /** core mulberry32 step → [0,1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** integer in [0, n) */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** inclusive int range [min, max] */
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** true with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** pick a random element */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** hash a string to a uint32 (used to derive seeds from codes) */
  static hashStr(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
