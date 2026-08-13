export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export class SeededRng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(hashSeed(seed));
  }

  float(): number {
    return this.next();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  weighted<T extends string>(weights: Record<T, number>): T {
    const keys = Object.keys(weights) as T[];
    const total = keys.reduce((s, k) => s + weights[k], 0);
    let r = this.next() * total;
    for (const k of keys) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return keys[keys.length - 1]!;
  }
}
