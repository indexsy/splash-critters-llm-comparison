import { CONFIG } from './config'
import { generateMap } from './map'
import { TILE } from './types'
import type {
  Balloon,
  Duck,
  Dir,
  ExcludableDir,
  InputTick,
  PowerupType,
  SimEvent,
  SimPlayer,
  SimState,
  Splash
} from './types'

const BODY = 0.36
const EPS = 1e-4

export interface SimOptions {
  ducks?: boolean
  kick?: boolean
}

export function createSimState(
  mode: 'duel' | 'ffa',
  seed: number,
  opts: SimOptions = {}
): SimState {
  const map = generateMap(mode, seed)
  const players: SimPlayer[] = map.spawns.map(([x, y], i) => ({
    id: i,
    x: x + 0.5,
    y: y + 0.5,
    facing: 'down',
    alive: true,
    stats: {
      speed: CONFIG.SPEED_BASE,
      balloonCount: CONFIG.BALLOONS_BASE,
      splashRange: CONFIG.RANGE_BASE,
      boots: false
    },
    activeBalloons: 0,
    roundsWon: 0,
    soaks: 0,
    castlesWashed: 0
  }))
  return {
    tick: 0,
    W: map.W,
    H: map.H,
    grid: map.grid,
    players,
    balloons: [],
    splashes: [],
    powerups: new Map(),
    contents: map.contents,
    tideStartTick: CONFIG.ROUND_TICKS,
    tideRing: -1,
    ducks: [],
    ducksEnabled: opts.ducks ?? false,
    kickEnabled: opts.kick ?? CONFIG.ENABLE_KICK,
    rngState: seed >>> 0,
    nextId: 1,
    over: false,
    winnerIds: [],
    draw: false
  }
}

const tileIdx = (s: SimState, x: number, y: number): number => y * s.W + x

function balloonAt(s: SimState, tx: number, ty: number): Balloon | undefined {
  for (const b of s.balloons) if (b.tx === tx && b.ty === ty) return b
  return undefined
}

function isSolid(t: number): boolean {
  return t === TILE.BOULDER || t === TILE.CASTLE
}

function blockedFor(s: SimState, p: SimPlayer, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= s.W || ty >= s.H) return true
  if (isSolid(s.grid[tileIdx(s, tx, ty)]!)) return true
  const b = balloonAt(s, tx, ty)
  if (b) {
    const onTile = Math.floor(p.x) === tx && Math.floor(p.y) === ty
    if (!(b.ownerId === p.id && onTile)) return true
  }
  return false
}

function computeRangeCells(s: SimState, bx: number, by: number, range: number): number[] {
  const cells = [tileIdx(s, bx, by)]
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
      const t = s.grid[tileIdx(s, x, y)]
      if (t === TILE.BOULDER) break
      cells.push(tileIdx(s, x, y))
      if (t === TILE.CASTLE) break
    }
  }
  return cells
}

function applyStat(pu: PowerupType, p: SimPlayer): void {
  switch (pu) {
    case 'extra_balloon':
      p.stats.balloonCount = Math.min(CONFIG.BALLOONS_CAP, p.stats.balloonCount + 1)
      break
    case 'big_splash':
      p.stats.splashRange = Math.min(CONFIG.RANGE_CAP, p.stats.splashRange + 1)
      break
    case 'flippers':
      p.stats.speed = Math.min(CONFIG.SPEED_CAP, p.stats.speed + CONFIG.SPEED_PER_FLIPPERS)
      break
    case 'boots':
      p.stats.boots = true
      break
  }
}

function spawnDuck(s: SimState, p: SimPlayer): void {
  if (!s.ducksEnabled) return
  const px = Math.floor(p.x)
  const py = Math.floor(p.y)
  let best = { x: 1, y: 1 }
  let bestD = Infinity
  const seq = perimeterSeq(s.W, s.H)
  for (let i = 0; i < seq.length; i++) {
    const [x, y] = seq[i]!
    const d = Math.abs(x - px) + Math.abs(y - py)
    if (d < bestD) {
      bestD = d
      best = { x, y }
    }
  }
  const stepInt = seq.findIndex(([x, y]) => x === best.x && y === best.y)
  s.ducks.push({ playerId: p.id, stepInt: Math.max(0, stepInt), frac: 0, cooldown: CONFIG.DUCK_LOB_COOLDOWN_TICKS })
}

const perimeterCache = new Map<string, Array<[number, number]>>()

export function perimeterSeq(W: number, H: number): Array<[number, number]> {
  const key = `${W}x${H}`
  const hit = perimeterCache.get(key)
  if (hit) return hit
  const tiles: Array<[number, number]> = []
  const ok = (x: number, y: number) => Math.min(x, W - 1 - x, y, H - 1 - y) === 1
  for (let x = 1; x <= W - 2; x++) tiles.push([x, 1])
  for (let y = 2; y <= H - 2; y++) tiles.push([W - 2, y])
  for (let x = W - 3; x >= 1; x--) tiles.push([x, H - 2])
  for (let y = H - 3; y >= 2; y--) tiles.push([1, y])
  perimeterCache.set(key, tiles)
  return tiles
}

function duckPos(W: number, H: number, d: Duck): { x: number; y: number } {
  const seq = perimeterSeq(W, H)
  const a = seq[d.stepInt % seq.length]!
  const b = seq[(d.stepInt + 1) % seq.length]!
  return { x: a[0] + (b[0] - a[0]) * d.frac + 0.5, y: a[1] + (b[1] - a[1]) * d.frac + 0.5 }
}

function removeBalloon(s: SimState, b: Balloon): void {
  s.balloons = s.balloons.filter((x) => x.id !== b.id)
  if (b.ownerId >= 0) {
    const owner = s.players[b.ownerId]
    if (owner) owner.activeBalloons = Math.max(0, owner.activeBalloons - 1)
  }
}

function stepMovement(s: SimState, p: SimPlayer, dir: ExcludableDir): void {
  p.facing = dir
  const step = p.stats.speed / CONFIG.TICK_RATE
  const dv =
    dir === 'left'
      ? { x: -1, y: 0 }
      : dir === 'right'
        ? { x: 1, y: 0 }
        : dir === 'up'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 }

  const axis: 'x' | 'y' = dv.x !== 0 ? 'x' : 'y'
  const other: 'x' | 'y' = axis === 'x' ? 'y' : 'x'
  const sign = axis === 'x' ? dv.x : dv.y

  const otherCenter = Math.floor(p[other]) + 0.5
  const diff = otherCenter - p[other]
  if (Math.abs(diff) > EPS) {
    const amt = Math.sign(diff) * Math.min(Math.abs(diff), step)
    p[other] += amt
    return
  }

  const before = p[axis]
  let after = before + sign * step
  const oldLead = Math.floor(before + sign * BODY)
  const newLead = Math.floor(after + sign * BODY)
  if (newLead !== oldLead) {
    const bandTile = Math.floor(p[other])
    const blocked =
      axis === 'x' ? blockedFor(s, p, newLead, bandTile) : blockedFor(s, p, bandTile, newLead)
    if (blocked) {
      after = sign > 0 ? newLead - BODY - EPS : newLead + 1 + BODY + EPS
    }
  }
  p[axis] = after
}

function soak(s: SimState, p: SimPlayer, by: number, evs: SimEvent[]): void {
  p.alive = false
  evs.push({ t: 'player_soaked', playerId: p.id, by })
  spawnDuck(s, p)
}

export interface Predictor {
  x: number
  y: number
  facing: Dir
  speed: number
  id: number
}

/** Client-side local movement prediction — mirrors in-match movement physics. */
export function predictStep(
  grid: Uint8Array,
  W: number,
  H: number,
  balloons: Array<{ tx: number; ty: number; ownerId: number }>,
  self: Predictor,
  dir: Dir
): void {
  if (dir === 'none') return
  self.facing = dir
  const step = self.speed / CONFIG.TICK_RATE
  const INFO: Record<ExcludableDir, { x: number; y: number }> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  }
  const dv = INFO[dir]
  const axis: 'x' | 'y' = dv.x !== 0 ? 'x' : 'y'
  const other: 'x' | 'y' = axis === 'x' ? 'y' : 'x'
  const sign = axis === 'x' ? dv.x : dv.y
  const blocked = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true
    const t = grid[ty * W + tx]
    if (t === TILE.BOULDER || t === TILE.CASTLE) return true
    const b = balloons.find((bb) => bb.tx === tx && bb.ty === ty)
    if (b) {
      const onTile = Math.floor(self.x) === tx && Math.floor(self.y) === ty
      if (!(b.ownerId === self.id && onTile)) return true
    }
    return false
  }
  const otherCenter = Math.floor(self[other]) + 0.5
  const diff = otherCenter - self[other]
  if (Math.abs(diff) > EPS) {
    self[other] += Math.sign(diff) * Math.min(Math.abs(diff), step)
    return
  }
  const before = self[axis]
  let after = before + sign * step
  const oldLead = Math.floor(before + sign * BODY)
  const newLead = Math.floor(after + sign * BODY)
  if (newLead !== oldLead) {
    const bandTile = Math.floor(self[other])
    const blockedT = axis === 'x' ? blocked(newLead, bandTile) : blocked(bandTile, newLead)
    if (blockedT) after = sign > 0 ? newLead - BODY - EPS : newLead + 1 + BODY + EPS
  }
  self[axis] = after
}

export function simulateTick(s: SimState, inputs: Map<number, InputTick>): SimEvent[] {
  const evs: SimEvent[] = []
  if (s.over) return evs
  s.tick++

  for (const p of s.players) {
    if (!p.alive) continue
    const input = inputs.get(p.id)
    if (!input) continue

    if (input.dir !== 'none') {
      if (s.kickEnabled && p.stats.boots) {
        const dv = DIRS_V[input.dir as ExcludableDir]
        const aheadX = Math.floor(p.x) + dv.x
        const aheadY = Math.floor(p.y) + dv.y
        const target = balloonAt(s, aheadX, aheadY)
        if (target) {
          target.slide = input.dir as ExcludableDir
          target.slideAcc = 0
          evs.push({ t: 'balloon_kicked', id: target.id, dir: target.slide, x: aheadX, y: aheadY })
          continue
        }
      }
      stepMovement(s, p, input.dir as ExcludableDir)
    }

    if (input.balloon) {
      const tx = Math.floor(p.x)
      const ty = Math.floor(p.y)
      if (p.activeBalloons < p.stats.balloonCount && !balloonAt(s, tx, ty)) {
        s.balloons.push({
          id: s.nextId++,
          tx,
          ty,
          ownerId: p.id,
          fuse: CONFIG.FUSE_TICKS,
          range: p.stats.splashRange,
          chainDepth: 0,
          slide: null,
          slideAcc: 0
        })
        p.activeBalloons++
      }
    }
  }

  const slideStep = (CONFIG.BALLOON_SLIDE_TPS * 2) / CONFIG.TICK_RATE
  for (const b of [...s.balloons]) {
    if (!b.slide) continue
    b.slideAcc += slideStep
    while (b.slideAcc >= 1 && b.slide) {
      b.slideAcc -= 1
      const dv = DIRS_V[b.slide]
      const nx = b.tx + dv.x
      const ny = b.ty + dv.y
      const blocked =
        nx < 0 ||
        ny < 0 ||
        nx >= s.W ||
        ny >= s.H ||
        isSolid(s.grid[tileIdx(s, nx, ny)]!) ||
        s.grid[tileIdx(s, nx, ny)]! === TILE.FLOOD ||
        !!balloonAt(s, nx, ny) ||
        s.players.some((p) => p.alive && Math.floor(p.x) === nx && Math.floor(p.y) === ny)
      if (blocked) {
        b.slide = null
        b.slideAcc = 0
      } else {
        b.tx = nx
        b.ty = ny
      }
    }
  }

  type BurstEntry = { b: Balloon; depth: number }
  const bursts: BurstEntry[] = []
  const burstSet = new Set<number>()
  for (const b of s.balloons) {
    b.fuse--
    if (b.fuse <= 0 && !burstSet.has(b.id)) {
      burstSet.add(b.id)
      bursts.push({ b, depth: b.chainDepth })
    }
  }

  while (bursts.length) {
    const { b, depth } = bursts.shift()!
    if (!s.balloons.includes(b)) continue
    removeBalloon(s, b)
    if (b.ownerId >= 0) s.players[b.ownerId]!.castlesWashed += 0
    evs.push({ t: 'chain_burst', x: b.tx, y: b.ty, depth, owner: b.ownerId })

    const cells = computeRangeCells(s, b.tx, b.ty, b.range)
    for (const c of cells) {
      const cx = c % s.W
      const cy = Math.floor(c / s.W)
      const t = s.grid[c]
      if (t === TILE.CASTLE) {
        s.grid[c] = TILE.EMPTY
        if (b.ownerId >= 0) s.players[b.ownerId]!.castlesWashed++
        evs.push({ t: 'castle_washed', x: cx, y: cy, by: b.ownerId })
        const pu = s.contents.get(c)
        if (pu) {
          s.contents.delete(c)
          s.powerups.set(c, pu)
          evs.push({ t: 'powerup_revealed', x: cx, y: cy, type: pu })
        }
      } else {
        s.powerups.delete(c)
      }
      const chain = balloonAt(s, cx, cy)
      if (chain && !burstSet.has(chain.id)) {
        burstSet.add(chain.id)
        if (chain.ownerId >= 0) {
          const ow = s.players[chain.ownerId]
          if (ow && chain.fuse > 0) ow.activeBalloons = Math.max(0, ow.activeBalloons - 1)
        }
        chain.fuse = 0
        bursts.push({ b: chain, depth: depth + 1 })
      }
    }
    s.splashes.push({
      id: s.nextId++,
      cells,
      owner: b.ownerId,
      until: s.tick + CONFIG.SPLASH_TICKS,
      born: s.tick
    })
  }

  for (const sp of s.splashes) {
    for (const c of sp.cells) {
      const cx = c % s.W
      const cy = Math.floor(c / s.W)
      for (const p of s.players) {
        if (!p.alive) continue
        if (Math.floor(p.x) === cx && Math.floor(p.y) === cy) soak(s, p, sp.owner, evs)
      }
    }
  }

  for (const p of s.players) {
    if (!p.alive) continue
    const ci = tileIdx(s, Math.floor(p.x), Math.floor(p.y))
    const pu = s.powerups.get(ci)
    if (pu) {
      s.powerups.delete(ci)
      applyStat(pu, p)
      evs.push({ t: 'powerup_collected', playerId: p.id, type: pu, x: ci % s.W, y: Math.floor(ci / s.W) })
    }
  }

  if (s.tideRing < 0 && s.tick >= s.tideStartTick) {
    s.tideRing = 0
    evs.push({ t: 'tide_advance', ring: 0 })
  } else if (s.tideRing >= 0) {
    const want = Math.min(6, Math.floor((s.tick - s.tideStartTick) / CONFIG.TIDE_RING_TICKS))
    if (want > s.tideRing) {
      s.tideRing = want
      evs.push({ t: 'tide_advance', ring: want })
    }
  }
  if (s.tideRing >= 0) {
    for (let y = 0; y < s.H; y++) {
      for (let x = 0; x < s.W; x++) {
        const d = Math.min(x, s.W - 1 - x, y, s.H - 1 - y)
        if (d !== s.tideRing) continue
        const c = tileIdx(s, x, y)
        if (s.grid[c] === TILE.FLOOD) continue
        const swallowed = [...s.balloons].filter((b) => b.tx === x && b.ty === y)
        for (const b of swallowed) {
          if (b.fuse > 30) b.fuse = 30
        }
        if (s.grid[c] === TILE.CASTLE) {
          s.grid[c] = TILE.EMPTY
          evs.push({ t: 'castle_washed', x, y, by: -1 })
        }
        s.powerups.delete(c)
        s.grid[c] = TILE.FLOOD
      }
    }
    for (const p of s.players) {
      if (!p.alive) continue
      const c = s.grid[tileIdx(s, Math.floor(p.x), Math.floor(p.y))]
      if (c === TILE.FLOOD) soak(s, p, -2, evs)
    }
  }

  for (const duck of s.ducks) {
    duck.cooldown--
    duck.frac += CONFIG.DUCK_SPEED_TPS / CONFIG.TICK_RATE
    while (duck.frac >= 1) {
      duck.frac -= 1
      duck.stepInt++
    }
    if (duck.cooldown <= 0) {
      duck.cooldown = CONFIG.DUCK_LOB_COOLDOWN_TICKS
      const pos = duckPos(s.W, s.H, duck)
      const target = nearestAliveTile(s, Math.floor(pos.x), Math.floor(pos.y))
      if (target) {
        const def =
          Math.abs(target.x - Math.floor(pos.x)) >= Math.abs(target.y - Math.floor(pos.y))
            ? { x: Math.sign(target.x - Math.floor(pos.x)) as 0 | 1 | -1, y: 0 }
            : { x: 0, y: Math.sign(target.y - Math.floor(pos.y)) as 0 | 1 | -1 }
        let lx = Math.floor(pos.x)
        let ly = Math.floor(pos.y)
        let land = 0
        for (let k = 1; k <= CONFIG.DUCK_LOB_RANGE; k++) {
          const cx = Math.floor(pos.x) + def.x * k
          const cy = Math.floor(pos.y) + def.y * k
          if (cx < 0 || cy < 0 || cx >= s.W || cy >= s.H) break
          if (isSolid(s.grid[tileIdx(s, cx, cy)]!)) break
          lx = cx
          ly = cy
          land = k
        }
        if (land > 0) {
          const dirName: ExcludableDir =
            def.x === 1 ? 'right' : def.x === -1 ? 'left' : def.y === 1 ? 'down' : 'up'
          s.balloons.push({
            id: s.nextId++,
            tx: lx,
            ty: ly,
            ownerId: duck.playerId,
            fuse: 45,
            range: CONFIG.RANGE_BASE,
            chainDepth: 0,
            slide: null,
            slideAcc: 0
          })
          evs.push({ t: 'revenge_lob', playerId: duck.playerId, x: lx, y: ly, dir: dirName })
        }
      }
    }
  }

  s.splashes = s.splashes.filter((sp: Splash) => sp.until > s.tick)

  const alive = s.players.filter((p) => p.alive)
  if (alive.length <= 1) {
    s.over = true
    s.draw = alive.length === 0
    s.winnerIds = alive.map((p) => p.id)
    evs.push({ t: 'round_over', winnerIds: s.winnerIds, draw: s.draw })
  }

  return evs
}

function nearestAliveTile(s: SimState, fx: number, fy: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (const p of s.players) {
    if (!p.alive) continue
    const d = Math.abs(Math.floor(p.x) - fx) + Math.abs(Math.floor(p.y) - fy)
    if (d < bestD) {
      bestD = d
      best = { x: Math.floor(p.x), y: Math.floor(p.y) }
    }
  }
  return best
}

const DIRS_V: Record<ExcludableDir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
}
