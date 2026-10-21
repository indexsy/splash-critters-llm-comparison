import { CONFIG } from './config'
import { mulberry32, type Rng } from './rng'
import { TILE } from './types'
import type { GameMode, MapTheme, PowerupType } from './types'

export interface GeneratedMap {
  W: number
  H: number
  grid: Uint8Array
  spawns: Array<[number, number]>
  contents: Map<number, PowerupType>
  rects: { W: number; H: number }
}

export function mapSizeFor(mode: GameMode): { W: number; H: number } {
  return CONFIG.MAPS[mode]
}

function spawnSafeTiles(spawns: Array<[number, number]>, W: number, H: number): Set<number> {
  const safe = new Set<number>()
  const push = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) safe.add(y * W + x)
  }
  for (const [sx, sy] of spawns) {
    push(sx, sy)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      for (let d = 1; d <= 2; d++) push(sx + dx * d, sy + dy * d)
    }
  }
  return safe
}

export function generateMap(mode: GameMode, seed: number): GeneratedMap {
  const { W, H } = mapSizeFor(mode)
  const rng = mulberry32(seed)
  const grid = new Uint8Array(W * H)
  const idx = (x: number, y: number) => y * W + x

  let spawns: Array<[number, number]>
  if (mode === 'duel') {
    spawns = [
      [1, 1],
      [W - 2, H - 2]
    ]
  } else {
    spawns = [
      [1, 1],
      [W - 2, 1],
      [1, H - 2],
      [W - 2, H - 2]
    ]
  }

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        grid[idx(x, y)] = TILE.BOULDER
      } else if (x % 2 === 0 && y % 2 === 0) {
        grid[idx(x, y)] = TILE.BOULDER
      }
    }
  }

  const safe = spawnSafeTiles(spawns, W, H)
  const contents = new Map<number, PowerupType>()
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y)
      if (grid[i] !== TILE.EMPTY || safe.has(i)) continue
      if (rng.next() >= CONFIG.CASTLE_DENSITY) continue
      grid[i] = TILE.CASTLE
      if (rng.next() < CONFIG.POWERUP_BLOCK_CHANCE) {
        contents.set(i, rollPowerup(rng))
      }
    }
  }

  return { W, H, grid, spawns, contents, rects: { W, H } }
}

export function rollPowerup(rng: Rng): PowerupType {
  const r = rng.next()
  let acc = 0
  for (const [type, weight] of Object.entries(CONFIG.POWERUP_WEIGHTS)) {
    acc += weight
    if (r < acc) return type as PowerupType
  }
  return 'extra_balloon'
}

export function pickTheme(rand: Rng | null, requested: MapTheme | 'random'): MapTheme {
  if (requested !== 'random') return requested
  return THEMES_ALL[Math.floor((rand ? rand.next() : Math.random()) * THEMES_ALL.length)] as MapTheme
}

export const THEMES_ALL: MapTheme[] = [...CONFIG.THEMES]
