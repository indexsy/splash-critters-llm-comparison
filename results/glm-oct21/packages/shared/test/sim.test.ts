import { describe, expect, it } from 'vitest'
import { CONFIG, createSimState, generateMap, mulberry32, simulateTick } from '../src'
import type { InputTick } from '../src/types'

function input(dir: InputTick['dir'] = 'none', balloon = false, seq = 0): InputTick {
  return { seq, dir, balloon }
}

function noInputs(n: number): Map<number, InputTick> {
  return new Map([...Array(n).keys()].map((i) => [i, input()]))
}

describe('map generation determinism', () => {
  it('same seed produces identical map + hidden contents', () => {
    const a = generateMap('ffa', 98765)
    const b = generateMap('ffa', 98765)
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid))
    expect([...a.contents.entries()]).toEqual([...b.contents.entries()])
  })

  it('different seed differs in castles', () => {
    const a = generateMap('ffa', 1234)
    const b = generateMap('ffa', 4321)
    expect(Array.from(a.grid)).not.toEqual(Array.from(b.grid))
  })

  it('spawns + 2 adjacent per direction are castle/boulder-free', () => {
    const maps = [generateMap('duel', 42), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => generateMap('ffa', i))]
    for (const m of maps) {
      for (const [sx, sy] of m.spawns) {
        const safe = new Set<number>()
        safe.add(sy * m.W + sx)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ] as const)
          for (let d = 1; d <= 2; d++) safe.add((sy + dy * d) * m.W + (sx + dx * d))
        for (const i of safe) {
          if (i < 0 || i >= m.grid.length) continue
          expect(m.grid[i]).not.toBe(2)
        }
      }
    }
  })

  it('prng is stateful-deterministic', () => {
    const r1 = mulberry32(77)
    const r2 = mulberry32(77)
    for (let i = 0; i < 50; i++) expect(r1.next()).toBe(r2.next())
  })
})

describe('balloons and splash', () => {
  it('fuse burst is 90 ticks and splash lingers 12', () => {
    const s = createSimState('duel', 1)
    const p = s.players[0]!
    p.x = 2.5
    p.y = 2.5
    simulateTick(s, new Map([[0, input('none', true)]]))
    p.x = 6.5
    p.y = 2.5
    expect(s.balloons).toHaveLength(1)
    expect(s.balloons[0]!.fuse).toBe(CONFIG.FUSE_TICKS - 1)
    for (let i = 0; i < CONFIG.FUSE_TICKS - 1; i++) simulateTick(s, noInputs(2))
    expect(s.balloons).toHaveLength(0)
    expect(s.splashes).toHaveLength(1)
    const sp = s.splashes[0]!
    expect(sp.until - s.tick).toBe(CONFIG.SPLASH_TICKS)
    for (let i = 0; i < CONFIG.SPLASH_TICKS + 1 && s.splashes.length; i++) simulateTick(s, noInputs(2))
    expect(s.splashes).toHaveLength(0)
  })

  it('splash is cross-shaped: boulder blocks further', () => {
    const s = createSimState('duel', 5)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    s.grid[2 * s.W + 8] = 1
    const p = s.players[0]!
    p.x = 6.5
    p.y = 2.5
    simulateTick(s, new Map([[0, input('none', true)]]))
    p.x = 1.5
    p.y = 1.5
    for (let i = 0; i < CONFIG.FUSE_TICKS + 1; i++) simulateTick(s, noInputs(2))
    const cells = s.splashes[0]!.cells
    expect(cells.includes(2 * s.W + 6)).toBe(true)
    expect(cells.includes(2 * s.W + 8)).toBe(false)
    expect(cells.includes(2 * s.W + 9)).toBe(false)
  })

  it('splash stops at the first sandcastle', () => {
    const s = createSimState('duel', 77)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    s.grid[2 * s.W + 8] = 2
    s.grid[2 * s.W + 9] = 2
    const p = s.players[0]!
    p.x = 6.5
    p.y = 2.5
    s.players[1]!.x = 10.5
    s.players[1]!.y = 6.5
    simulateTick(s, new Map([[0, input('none', true)]]))
    p.x = 1.5
    p.y = 8.5
    const evs: unknown[][] = []
    for (let i = 0; i < CONFIG.FUSE_TICKS + 1; i++) evs.push(simulateTick(s, noInputs(2)))
    const cells = s.splashes[0]!.cells
    expect(cells.includes(2 * s.W + 8)).toBe(true)
    expect(cells.includes(2 * s.W + 9)).toBe(false)
    expect(s.players[1]!.alive).toBe(true)
    const washed = evs.flat().filter((e) => (e as { t: string }).t === 'castle_washed')
    expect(washed).toHaveLength(1)
  })

  it('3-balloon chain bursts in one tick with escalating depth', () => {
    const s = createSimState('duel', 3)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    const mk = (id: number, tx: number, ownerId: number, fuse: number) => ({
      id,
      tx,
      ty: 2,
      ownerId,
      fuse,
      range: 2,
      chainDepth: 0,
      slide: null,
      slideAcc: 0
    })
    const a = mk(0, 3, 0, 25)
    const b = mk(1, 5, 1, CONFIG.FUSE_TICKS)
    const c = mk(2, 7, 0, CONFIG.FUSE_TICKS)
    s.balloons = [a, b, c]
    s.players[0]!.activeBalloons = 2
    s.players[1]!.activeBalloons = 1
    const all: Array<{ t: string; depth?: number }> = []
    for (let i = 0; i < 27 && s.balloons.length; i++) all.push(...simulateTick(s, noInputs(2)))
    const chains = all.filter((e) => e.t === 'chain_burst')
    expect(chains).toHaveLength(3)
    expect(chains.map((e) => e.depth)).toEqual(expect.arrayContaining([0, 1, 2]))
    expect(s.balloons).toHaveLength(0)
    expect(s.splashes).toHaveLength(3)
  })

  it('chained balloon uses its own splashRange', () => {
    const s = createSimState('duel', 11)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    s.balloons = [
      { id: 0, tx: 3, ty: 2, ownerId: 0, fuse: 10, range: 2, chainDepth: 0, slide: null, slideAcc: 0 },
      { id: 1, tx: 5, ty: 2, ownerId: 1, fuse: CONFIG.FUSE_TICKS, range: 4, chainDepth: 0, slide: null, slideAcc: 0 }
    ]
    s.players[1]!.activeBalloons = 1
    for (let i = 0; i < 12 && s.splashes.length < 2; i++) simulateTick(s, noInputs(2))
    const chained = s.splashes.find((x) => x.owner === 1)
    expect(chained).toBeTruthy()
    expect(chained!.cells.length).toBe(1 + 4 + 4 + 4 + 1)
  })

  it('two players soaked same tick = draw', () => {
    const s = createSimState('duel', 4)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    const a = s.players[0]!
    const b = s.players[1]!
    a.x = 2.5
    a.y = 2.5
    b.x = 4.5
    b.y = 2.5
    s.balloons = [{ id: 0, tx: 2, ty: 2, ownerId: 0, fuse: 5, range: 3, chainDepth: 0, slide: null, slideAcc: 0 }]
    s.players[0]!.activeBalloons = 1
    for (let i = 0; i < 6; i++) simulateTick(s, noInputs(2))
    expect(s.over).toBe(true)
    expect(s.draw).toBe(true)
    expect(s.winnerIds).toHaveLength(0)
  })

  it('survivor wins the round', () => {
    const s = createSimState('duel', 4)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    const a = s.players[0]!
    const b = s.players[1]!
    a.x = 2.5
    a.y = 2.5
    b.x = 10.5
    b.y = 2.5
    s.balloons = [{ id: 0, tx: 2, ty: 2, ownerId: 0, fuse: 5, range: 1, chainDepth: 0, slide: null, slideAcc: 0 }]
    s.players[0]!.activeBalloons = 1
    for (let i = 0; i < 6; i++) simulateTick(s, noInputs(2))
    expect(s.over).toBe(true)
    expect(s.draw).toBe(false)
    expect(s.winnerIds).toEqual([1])
  })
})

describe('power-ups', () => {
  it('revealed on castle wash and collected on contact', () => {
    const s = createSimState('duel', 9)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    const cell = 2 * s.W + 8
    s.grid[cell] = 2
    s.contents.set(cell, 'extra_balloon')
    const before = s.players[0]!.stats.balloonCount
    s.players[0]!.x = 6.5
    s.players[0]!.y = 2.5
    simulateTick(s, new Map([[0, input('none', true)]]))
    s.players[0]!.x = 2.5
    s.players[0]!.y = 8.5
    s.players[1]!.x = 10.5
    s.players[1]!.y = 8.5
    let revealed = false
    for (let i = 0; i < CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS + 3; i++) {
      const evs = simulateTick(s, noInputs(2))
      if (evs.some((e) => e.t === 'powerup_revealed' && e.x === 8 && e.y === 2)) revealed = true
    }
    expect(revealed).toBe(true)
    s.players[0]!.x = 8.5
    s.players[0]!.y = 2.5
    s.players[1]!.x = 10.5
    s.players[1]!.y = 8.5
    const evs2 = simulateTick(s, new Map([[0, input('none', false)]]))
    expect(evs2.some((e) => e.t === 'powerup_collected')).toBe(true)
    expect(s.players[0]!.stats.balloonCount).toBe(before + 1)
    expect(s.powerups.size).toBe(0)
  })

  it('exposed powerup is destroyed by splash', () => {
    const s = createSimState('duel', 9)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    s.powerups.set(2 * s.W + 8, 'flippers')
    s.players[0]!.x = 6.5
    s.players[0]!.y = 2.5
    simulateTick(s, new Map([[0, input('none', true)]]))
    s.players[0]!.x = 2.5
    s.players[0]!.y = 2.5
    s.players[1]!.x = 10.5
    s.players[1]!.y = 8.5
    for (let i = 0; i < CONFIG.FUSE_TICKS; i++) simulateTick(s, noInputs(2))
    expect(s.powerups.size).toBe(0)
    expect(s.players[0]!.stats.speed).toBe(CONFIG.SPEED_BASE)
  })

  it('collecting all stat caps applies', () => {
    const s = createSimState('duel', 9)
    const p = s.players[0]!
    for (let i = 0; i < 10; i++) {
      s.powerups.set(2 * s.W + 8, 'extra_balloon')
      p.x = 8.5
      p.y = 2.5
      simulateTick(s, new Map([[0, input('none', false)]]))
    }
    expect(p.stats.balloonCount).toBe(CONFIG.BALLOONS_CAP)
  })
})

describe('kick mechanic', () => {
  it('balloon slides then stops on boulder, bursts along the way', () => {
    const s = createSimState('duel', 12)
    for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) s.grid[y * s.W + x] = 0
    s.grid[2 * s.W + 12] = 1
    const p = s.players[0]!
    p.x = 9.5
    p.y = 2.5
    p.stats.boots = true
    s.players[1]!.x = 5.5
    s.players[1]!.y = 7.5
    const b = {
      id: 0,
      tx: 10,
      ty: 2,
      ownerId: 0,
      fuse: 40,
      range: 2,
      chainDepth: 0,
      slide: null as null,
      slideAcc: 0
    }
    s.balloons = [b]
    s.players[0]!.activeBalloons = 1
    const evs: Array<{ t: string; x?: number }> = []
    for (let i = 0; i < 50; i++) evs.push(...simulateTick(s, new Map([[0, input('right')]])))
    expect(evs.some((e) => e.t === 'balloon_kicked')).toBe(true)
    const kicked = evs.find((e) => e.t === 'balloon_kicked') as { x?: number }
    expect(kicked.x).toBe(10)
    expect(s.splashes.some((sp) => sp.cells.includes(2 * s.W + 11))).toBe(true)
  })
})

describe('sudden death tide', () => {
  it('flood advances and kills players on flooded tiles', () => {
    const s = createSimState('duel', 8)
    s.tideStartTick = 10
    s.ducksEnabled = false
    const p = s.players[0]!
    p.x = 1.5
    p.y = 1.5
    s.players[1]!.x = 11.5
    s.players[1]!.y = 9.5
    for (let i = 0; i < 20; i++) simulateTick(s, noInputs(2))
    expect(s.tideRing).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < 10 * 30; i++) {
      if (s.over) break
      simulateTick(s, noInputs(2))
    }
    expect(s.over).toBe(true)
    expect(s.players[1]!.alive).toBe(false)
  })
})

describe('deterministic replay', () => {
  it('same seed + same inputs → identical outcome', () => {
    const run = () => {
      const s = createSimState('ffa', 2024)
      const dirSeq: InputTick['dir'][] = ['up', 'down', 'left', 'right', 'none']
      const log: string[] = []
      for (let t = 0; t < 1200 && !s.over; t++) {
        const ins = new Map<number, InputTick>()
        for (const p of s.players) {
          const d = dirSeq[(t * 7 + p.id * 3) % 5]!
          ins.set(p.id, input(d, t % 20 === 9, t))
        }
        const evs = simulateTick(s, ins)
        log.push(...evs.map((e) => JSON.stringify(e)))
      }
      return { log, state: { tick: s.tick, grid: [...s.grid], over: s.over, winners: s.winnerIds } }
    }
    const a = run()
    const b = run()
    expect(a.state).toEqual(b.state)
    expect(a.log).toEqual(b.log)
  })
})
