export interface Rng {
  next(): number
  int(n: number): number
  pick<T>(arr: readonly T[]): T
  state(): number
}

export class Mulberry32 implements Rng {
  private a: number
  constructor(seed: number) {
    this.a = seed >>> 0
  }
  next(): number {
    let a = (this.a = (this.a + 0x6d2b79f5) | 0)
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(n: number): number {
    return Math.floor(this.next() * n) % n
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T
  }
  state(): number {
    return this.a >>> 0
  }
}

export function mulberry32(seed: number): Rng {
  return new Mulberry32(seed)
}
