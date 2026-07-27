/**
 * mulberry32 - tiny, fast, seeded PRNG.
 *
 * Deterministic across every JS engine: the whole map (including hidden
 * power-up contents) is reproducible from a single 32-bit seed, which is what
 * makes replays and the seed-determinism tests possible.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Uniform integer in [min, max]. */
  range(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly picks an element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates, in place, returns the same array. */
  shuffle<T>(items: T[]): T[];
  /** Current internal state, so a stream can be resumed. */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    range: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('rng.pick on empty array');
      return items[Math.floor(next() * items.length)];
    },
    shuffle: <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      return items;
    },
    state: () => s,
  };
}

/** Non-deterministic seed for starting a fresh round. */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

/**
 * Weighted pick over a table of `{ weight }` entries. Weights need not sum to
 * one; the caller's table order defines the deterministic outcome.
 */
export function weightedPick<T extends { weight: number }>(rng: Rng, table: readonly T[]): T {
  let total = 0;
  for (const entry of table) total += entry.weight;
  let roll = rng.next() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return table[table.length - 1];
}
