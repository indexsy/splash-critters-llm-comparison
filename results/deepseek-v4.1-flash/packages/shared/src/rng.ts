export interface Rng {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
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
    int(minInclusive, maxExclusive) {
      if (maxExclusive <= minInclusive) return minInclusive;
      return Math.floor(next() * (maxExclusive - minInclusive)) + minInclusive;
    },
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("Cannot pick from an empty array");
      return item;
    },
    chance(probability: number) {
      return next() < probability;
    },
  };
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function roundSeed(baseSeed: number, roundNo: number): number {
  return (baseSeed + Math.imul(roundNo, 0x9e3779b1)) >>> 0;
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
