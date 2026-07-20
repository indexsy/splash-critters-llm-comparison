/**
 * Deterministic seeded PRNG — mulberry32.
 * The ONLY source of randomness in shared code. Identical seed => identical
 * stream on server and client (and in tests / replays).
 */

export interface Rng {
  /** next float in [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** float in [min, max) */
  range(min: number, max: number): number;
  /** true with probability p */
  chance(p: number): boolean;
  /** pick one item from a non-empty array */
  pick<T>(items: readonly T[]): T;
  /** current internal state (for forking / debugging) */
  readonly state: number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    range: (min: number, max: number) => min + next() * (max - min),
    chance: (p: number) => next() < p,
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    get state() {
      return a >>> 0;
    },
  };
}

/**
 * Turn an arbitrary string (room code, nickname) into a 32-bit seed.
 * Deterministic — used so a shareable code always maps to the same map.
 */
export function hashStringToSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mix two integers into a new deterministic seed (e.g. mapSeed + roundNo). */
export function mixSeeds(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 2654435761) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
