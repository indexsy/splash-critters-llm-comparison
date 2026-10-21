import { CONFIG, TILE } from '@splash/shared'
import type { SimState } from '@splash/shared'

export interface DangerMap {
  burstTick: Int32Array
  unsafe: (tile: number, arrivalTick: number) => boolean
  INF: number
}

export function computeDanger(s: SimState): DangerMap {
  const INF = 1 << 28
  const n = s.W * s.H
  const burstTick = new Int32Array(n).fill(INF)
  const idx = (x: number, y: number) => y * s.W + x

  interface Burst { tx: number; ty: number; range: number; t: number }
  const byBalloon = new Map<number, Burst>()
  for (const b of s.balloons) {
    const base = s.tick + Math.max(0, b.fuse)
    const entry = byBalloon.get(b.id)
    if (entry) {
      entry.t = Math.min(entry.t, base)
      entry.range = Math.max(entry.range, b.range)
    } else {
      byBalloon.set(b.id, { tx: b.tx, ty: b.ty, range: b.range, t: base })
    }
  }

  const inflight: Burst[] = [...byBalloon.values()].sort((a, b) => a.t - b.t)
  const touched = new Set<number>()
  let passLimit = 6
  while (inflight.length && passLimit-- > 0) {
    let changed = false
    const done = new Set<number>()
    for (const bl of inflight) {
      const key = bl.tx * 1000 + bl.ty
      if (done.has(key)) continue
      done.add(key)
      if (bl.t >= INF) continue
      spreadCells(s, bl.tx, bl.ty, bl.range, (x, y) => {
        const ti = idx(x, y)
        if (!touched.has(ti) || burstTick[ti]! > bl.t) {
          burstTick[ti] = Math.min(burstTick[ti]!, bl.t)
          touched.add(ti)
        }
        const chained = s.balloons.find((b) => b.tx === x && b.ty === y && b.id !== undefined)
        if (chained) {
          const ce = byBalloon.get(chained.id)!
          const t2 = Math.min(ce.t, bl.t)
          if (t2 < ce.t) {
            ce.t = t2
            changed = true
          }
        }
      })
    }
    if (!changed) break
  }

  return {
    burstTick,
    INF,
    unsafe: (tile: number, arrivalTick: number) => {
      const t = burstTick[tile]!
      if (t >= INF) return false
      return arrivalTick >= t - 0
    }
  }
}

function spreadCells(
  s: SimState,
  bx: number,
  by: number,
  range: number,
  fn: (x: number, y: number) => void
): void {
  fn(bx, by)
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]
  for (const [dx, dy] of dirs) {
    for (let d = 1; d <= range; d++) {
      const x = bx + dx * d
      const y = by + dy * d
      if (x < 0 || y < 0 || x >= s.W || y >= s.H) break
      const t = s.grid[y * s.W + x]
      if (t === TILE.BOULDER) break
      fn(x, y)
      if (t === TILE.CASTLE) break
    }
  }
}

export function tickIntervalFor(s: SimState, test: { tick: number }): number {
  void test
  return CONFIG.TIDE_RING_TICKS
}
