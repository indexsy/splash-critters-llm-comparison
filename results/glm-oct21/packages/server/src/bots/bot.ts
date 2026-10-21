import { CONFIG, TILE } from '@splash/shared'
import type { BotDifficulty, ExcludableDir, InputTick, SimPlayer, SimState } from '@splash/shared'
import { computeDanger } from './dangerMap'
const DIRS4: ReadonlyArray<[ExcludableDir, number, number]> = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0]
]

export interface BotBrain {
  playerId: number
  difficulty: BotDifficulty
  nextDecideTick: number
  plan: { dir: ExcludableDir | 'none'; drop: boolean }
}

export function createBotBrain(playerId: number, difficulty: BotDifficulty): BotBrain {
  return { playerId, difficulty, nextDecideTick: 0, plan: { dir: 'none', drop: false } }
}

function cellIdx(s: SimState, x: number, y: number): number {
  return y * s.W + x
}

function ticksPerTile(p: SimPlayer): number {
  return Math.ceil(CONFIG.TICK_RATE / p.stats.speed)
}

function splashCellIds(s: SimState, bx: number, by: number, range: number): number[] {
  const out = [cellIdx(s, bx, by)]
  for (const [dir, dx, dy] of DIRS4) {
    for (let d = 1; d <= range; d++) {
      const x = bx + dx * d
      const y = by + dy * d
      if (x < 0 || y < 0 || x >= s.W || y >= s.H) break
      const t = s.grid[cellIdx(s, x, y)]
      if (t === TILE.BOULDER) break
      out.push(cellIdx(s, x, y))
      if (t === TILE.CASTLE) break
    }
  }
  return out
}

interface Bfs {
  dist: Int32Array
  from: Int32Array
}

function bfs(
  s: SimState,
  from: { x: number; y: number },
  allow: (tile: number, depth: number) => boolean,
  maxDepth = 70
): Bfs {
  const n = s.W * s.H
  const dist = new Int32Array(n).fill(-1)
  const fromArr = new Int32Array(n).fill(-1)
  const start = cellIdx(s, from.x, from.y)
  dist[start] = 0
  const queue = [start]
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!
    if (dist[cur]! >= maxDepth) continue
    const cx = cur % s.W
    const cy = Math.floor(cur / s.W)
    for (const [, dx, dy] of DIRS4) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 1 || ny < 1 || nx > s.W - 2 || ny > s.H - 2) continue
      const ni = cellIdx(s, nx, ny)
      if (dist[ni]! >= 0) continue
      const t = s.grid[ni]!
      if (t === TILE.BOULDER || t === TILE.CASTLE) continue
      if (s.balloons.some((b) => b.tx === nx && b.ty === ny)) continue
      if (!allow(ni, dist[cur]! + 1)) continue
      dist[ni] = dist[cur]! + 1
      fromArr[ni] = cur
      queue.push(ni)
    }
  }
  return { dist, from: fromArr }
}

function stepToward(s: SimState, res: Bfs, target: number, start: number): ExcludableDir | null {
  if (target === start || res.dist[target]! < 0) return null
  let cur = target
  while (res.from[cur]! !== start) {
    if (res.from[cur]! < 0) return null
    cur = res.from[cur]!
    if (res.dist[cur]! === 0) return null
  }
  const sx = start % s.W
  const sy = Math.floor(start / s.W)
  const nx = cur % s.W
  const ny = Math.floor(cur / s.W)
  for (const [dir, dx, dy] of DIRS4) {
    if (sx + dx === nx && sy + dy === ny) return dir
  }
  return null
}

export function botDecide(state: SimState, brain: BotBrain): InputTick {
  const p = state.players[brain.playerId]
  if (!p || !p.alive || state.over) return { seq: 0, dir: 'none', balloon: false }

  const cfg = CONFIG.BOTS[brain.difficulty]
  const now = state.tick
  const curTile = cellIdx(state, Math.floor(p.x), Math.floor(p.y))
  const tpt = ticksPerTile(p)
  const danger = computeDanger(state)
  const easyMisjudge = brain.difficulty === 'easy' && Math.random() < cfg.mistakeChance
  const margin = brainsMargin(brain.difficulty)
  const isUnsafe = (tile: number, arrival: number) => danger.unsafe(tile, arrival + margin)

  const fleeUrgent = isUnsafe(curTile, now) && !easyMisjudge

  if (fleeUrgent) {
    const res = bfs(state, { x: Math.floor(p.x), y: Math.floor(p.y) }, (tile, depth) => {
      const arrival = now + depth * tpt
      return !isUnsafe(tile, arrival)
    })
    let best = -1
    for (let i = 0; i < res.dist.length; i++) {
      if (res.dist[i]! < 0) continue
      if (danger.burstTick[i]! < danger.INF) continue
      if (best < 0 || res.dist[i]! < res.dist[best]!) best = i
    }
    if (best >= 0) {
      const dir = stepToward(state, res, best, curTile)
      if (dir) {
        brain.plan = { dir, drop: false }
        return { seq: now, dir, balloon: false }
      }
    }
    return { seq: now, dir: 'none', balloon: false }
  }

  const decide = now >= brain.nextDecideTick
  if (!decide) {
    const dir = brain.plan.dir
    return { seq: now, dir: dir === 'none' ? 'none' : dir, balloon: false }
  }
  brain.nextDecideTick = now + cfg.decideEveryTicks

  const dropIsSafe = (): boolean => {
    if (p.activeBalloons >= p.stats.balloonCount) return false
    const bx = Math.floor(p.x)
    const by = Math.floor(p.y)
    if (state.balloons.some((b) => b.tx === bx && b.ty === by)) return false
    const overlay = new Map<number, number>()
    for (const c of splashCellIds(state, bx, by, p.stats.splashRange)) {
      overlay.set(c, now + CONFIG.FUSE_TICKS)
    }
    const res = bfs(state, { x: bx, y: by }, (tile, depth) => {
      const arrival = now + depth * tpt
      const nd = overlay.get(tile) ?? danger.INF
      const ed = danger.burstTick[tile] === undefined ? danger.INF : danger.burstTick[tile]!
      return arrival < Math.min(nd, ed)
    })
    for (let i = 0; i < res.dist.length; i++) {
      if (res.dist[i]! < 0) continue
      const nd = overlay.get(i) ?? danger.INF
      const ed = danger.burstTick[i] === undefined ? danger.INF : danger.burstTick[i]!
      if (now + res.dist[i]! * tpt + 1 < Math.min(nd, ed)) return true
    }
    return false
  }

  const enemies = state.players.filter((e) => e.alive && e.id !== p.id)
  let target: { tile: number; kind: 'pu' | 'castle' | 'enemy' | 'wander' } | null = null
  let bestDist = Infinity

  for (const [tile] of state.powerups) {
    const tx = tile % state.W
    const ty = Math.floor(tile / state.W)
    const d = Math.abs(tx - Math.floor(p.x)) + Math.abs(ty - Math.floor(p.y))
    if (d < bestDist) {
      bestDist = d
      target = { tile, kind: 'pu' }
    }
  }
  if (brain.difficulty !== 'easy' || !target) {
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] !== TILE.CASTLE) continue
      const d = Math.abs((i % state.W) - Math.floor(p.x)) + Math.abs(Math.floor(i / state.W) - Math.floor(p.y))
      if (d < bestDist) {
        bestDist = d
        target = { tile: i, kind: 'castle' }
      }
    }
  }
  if (brain.difficulty === 'hard' && enemies.length) {
    const e = enemies.reduce((a, b) => {
      const da = Math.abs(Math.floor(a.x) - Math.floor(p.x)) + Math.abs(Math.floor(a.y) - Math.floor(p.y))
      const db = Math.abs(Math.floor(b.x) - Math.floor(p.x)) + Math.abs(Math.floor(b.y) - Math.floor(p.y))
      return da < db ? a : b
    })
    const d = Math.abs(Math.floor(e.x) - Math.floor(p.x)) + Math.abs(Math.floor(e.y) - Math.floor(p.y))
    if (d <= bestDist + 2) {
      target = { tile: cellIdx(state, Math.floor(e.x), Math.floor(e.y)), kind: 'enemy' }
      bestDist = d
    }
  }

  if (target && bestDist <= (target.kind === 'enemy' ? cfg.attackRange : bestDist) && target.kind !== 'wander') {
    if (target.kind === 'enemy' && bestDist <= cfg.attackRange && dropIsSafe()) {
      brain.plan = { dir: 'none', drop: true }
      return { seq: now, dir: 'none' as ExcludableDir, balloon: true }
    }
    const alignedInSplash =
      target.kind === 'castle'
        ? splashCellIds(state, Math.floor(p.x), Math.floor(p.y), p.stats.splashRange).includes(target.tile)
        : target.kind === 'enemy' && manhattan(state, p, target.tile) <= p.stats.splashRange
    if (alignedInSplash && dropIsSafe()) {
      brain.plan = { dir: 'none', drop: true }
      return { seq: now, dir: 'none' as ExcludableDir, balloon: true }
    }
  }

  let dir: ExcludableDir | 'none' = 'none'
  if (target && target.tile !== curTile) {
    const res = bfs(state, { x: Math.floor(p.x), y: Math.floor(p.y) }, (tile, depth) => {
      const arrival = now + depth * tpt
      if (tile === target!.tile) return true
      return !isUnsafe(tile, arrival)
    })
    if (res.dist[target.tile]! >= 0) {
      const step = stepToward(state, res, target.tile, curTile)
      if (step) dir = step
    }
  }

  if (brain.difficulty === 'hard' && p.stats.boots && enemies.length) {
    for (const b of state.balloons) {
      for (const e of enemies) {
        const onLine =
          (b.tx === Math.floor(e.x) && Math.abs(b.ty - Math.floor(p.y)) === 1 && b.tx === Math.floor(p.x)) ||
          (b.ty === Math.floor(e.y) && Math.abs(b.tx - Math.floor(p.x)) === 1 && b.ty === Math.floor(p.y))
        if (!onLine) continue
        const toward: ExcludableDir | null =
          b.tx === Math.floor(p.x)
            ? b.ty > Math.floor(p.y)
              ? 'down'
              : 'up'
            : b.tx > Math.floor(p.x)
              ? 'right'
              : 'left'
        if (toward) {
          dir = toward
        }
      }
    }
  }

  if (dir !== 'none') {
    brain.plan = { dir, drop: false }
    return { seq: now, dir, balloon: false }
  }

  // wander: random step so bots never freeze
  const passable = DIRS4.filter(([, dx, dy]) => {
    const nx = Math.floor(p.x) + dx
    const ny = Math.floor(p.y) + dy
    if (nx < 1 || ny < 1 || nx > state.W - 2 || ny > state.H - 2) return false
    const t = state.grid[cellIdx(state, nx, ny)]
    return t !== TILE.BOULDER && t !== TILE.CASTLE
  })
  if (passable.length && Math.random() < (brain.difficulty === 'easy' ? 0.9 : 0.5)) {
    const pick = passable[Math.floor(Math.random() * passable.length)]!
    brain.plan = { dir: pick[0], drop: false }
    return { seq: now, dir: pick[0], balloon: false }
  }
  return { seq: now, dir: 'none', balloon: false }
}

function manhattan(s: SimState, p: SimPlayer, tile: number): number {
  return Math.abs((tile % s.W) - Math.floor(p.x)) + Math.abs(Math.floor(tile / s.W) - Math.floor(p.y))
}

function brainsMargin(d: BotDifficulty): number {
  return d === 'hard' ? 2 : d === 'medium' ? 1 : 0
}
