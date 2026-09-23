// Seeded, portable pseudo-random numbers. The simulation never calls Math.random: every
// random decision (map generation, bot jitter) flows from one of these generators so the same
// seed reproduces the same round on the server, in tests and in replays.

/** Mulberry32: fast 32-bit PRNG. Returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 128-bit generator key: four 32-bit words. */
export type Key128 = readonly [number, number, number, number];

/**
 * SFC32 (Small Fast Chaotic, 128-bit state). Used where the stream must not be recoverable from
 * what players can see: with a 128-bit random key there is no seed space small enough to
 * brute-force from observed outputs, unlike a 32-bit seed. Returns floats in [0, 1).
 */
export function sfc32(key: Key128): () => number {
  let [a, b, c, d] = key.map((k) => k >>> 0);
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  // Warm up so that similar keys diverge before the first output is used.
  for (let i = 0; i < 12; i++) next();
  return () => next() / 4294967296;
}

/** Murmur3 32-bit finalizer: avalanches every input bit into every output bit. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Folds one 32-bit word into a running hash (murmur3 block step). */
function mixWord(h: number, word: number): number {
  let k = Math.imul(word >>> 0, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
}

/**
 * Mixes any number of integers (e.g. match seed, round number, slot) into one uint32 seed.
 * Values beyond 32 bits (timestamps) contribute both their low and high words.
 */
export function hashSeed(...n: number[]): number {
  let h = 0x9e3779b9;
  for (const v of n) {
    const int = Math.trunc(v);
    h = mixWord(h, int >>> 0);
    h = mixWord(h, Math.floor(int / 4294967296) >>> 0);
  }
  return fmix32(h ^ n.length);
}

/** Uniform integer in [0, n). */
export function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}
