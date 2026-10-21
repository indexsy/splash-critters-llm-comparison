import { TILE } from '@splash/shared'
import type { MapTheme, PowerupType } from '@splash/shared'

export const PAL = {
  K: '#0e0e24',
  W: '#f8f8f8',
  Y: '#ffd23f',
  O: '#ff8d2e',
  R: '#e94f37',
  G: '#3ecf6e',
  D: '#1f9e50',
  B: '#3aa0ff',
  N: '#1d6fd2',
  P: '#b96bff',
  V: '#6a33c8',
  S: '#f0d9a8',
  T: '#c98d5a',
  A: '#f4a9a3',
  Q: '#ffe9a3',
  C: '#8fe3e0',
  L: '#9ccf5a',
  M: '#5a8f34',
  E: '#252c44',
  F: '#7ec9ff',
  U: '#4a5b7a',
  X: '#2a2140'
} as const

const PAL_KEYS: Record<string, string> = PAL as unknown as Record<string, string>

export function cv(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function paint(spec: string[], w = 16, h = 16): HTMLCanvasElement {
  const c = cv(w, h)
  const g = c.getContext('2d')!
  for (let y = 0; y < Math.min(spec.length, h); y++) {
    const row = spec[y]!
    for (let x = 0; x < Math.min(row.length, w); x++) {
      const ch = row[x]!
      if (ch === '.') continue
      g.fillStyle = PAL_KEYS[ch] ?? '#ff00ff'
      g.fillRect(x, y, 1, 1)
    }
  }
  return c
}

export type AnimalId = 'frog' | 'duck' | 'otter' | 'penguin' | 'cat' | 'raccoon' | 'turtle' | 'capybara'
export type HatId = 'none' | 'bucket' | 'snorkel' | 'bandana' | 'crown' | 'propeller'

export interface AnimalFrames {
  a: HTMLCanvasElement
  b: HTMLCanvasElement
  soak: HTMLCanvasElement
}

const ANIMAL_STYLE: Record<AnimalId, { body: string; belly: string; feet: string; hasEars: boolean }> = {
  frog: { body: 'G', belly: 'Q', feet: 'D', hasEars: false },
  duck: { body: 'Y', belly: 'Q', feet: 'O', hasEars: false },
  otter: { body: 'T', belly: 'S', feet: 'T', hasEars: true },
  penguin: { body: 'N', belly: 'W', feet: 'O', hasEars: false },
  cat: { body: 'A', belly: 'W', feet: 'A', hasEars: true },
  raccoon: { body: 'U', belly: 'C', feet: 'U', hasEars: true },
  turtle: { body: 'M', belly: 'S', feet: 'M', hasEars: false },
  capybara: { body: 'T', belly: 'S', feet: 'T', hasEars: false }
}

function animalCanvas(kind: AnimalId, frame: 0 | 1, soaked: boolean): HTMLCanvasElement {
  const st = ANIMAL_STYLE[kind]
  const bob = frame === 1 ? 1 : 0
  const rows: string[] = []
  const W = 16
  for (let y = 0; y < 16; y++) rows.push('.'.repeat(W))
  const put = (x: number, y: number, ch: string) => {
    if (y < 0 || y >= 16 || x < 0 || x >= W) return
    rows[y] = rows[y]!.substring(0, x) + ch + rows[y]!.substring(x + 1)
  }
  const top = 4 + bob
  for (let y = 0; y < 9; y++) {
    for (let x = 3; x <= 12; x++) {
      if ((x === 3 || x === 12) && y < 3) continue
      if ((x === 4 || x === 11) && y < 1) continue
      const belly = y >= 5 && x >= 5 && x <= 10
      put(x, top + y, belly ? st.belly : st.body)
    }
  }
  if (st.hasEars) {
    put(4, top - 1, st.body)
    put(5, top - 2, st.body)
    put(10, top - 2, st.body)
    put(11, top - 1, st.body)
  }
  if (kind === 'duck') {
    put(8, top - 1, st.body)
    put(9, top - 2, 'O')
  }
  if (kind === 'frog') {
    put(5, top - 1, st.body)
    put(10, top - 1, st.body)
    put(5, top - 2, 'K')
    put(10, top - 2, 'K')
  }
  if (!soaked) {
    put(6, top + 3, 'K')
    put(9, top + 3, 'K')
    put(7, top + 5, st.belly === 'W' ? 'K' : st.body)
    put(8, top + 5, st.belly === 'W' ? 'K' : st.body)
    const fy = top + 9 + (frame === 1 ? 0 : 1)
    put(5, fy, st.feet)
    put(6, fy, st.feet)
    put(10, fy, st.feet)
    put(11, fy, st.feet)
  } else {
    put(5, top + 3, 'K')
    put(7, top + 3, 'K')
    put(10, top + 3, 'K')
    put(7, top + 6, 'F')
    put(8, top + 6, 'F')
  }
  return paint(rows, W, 16)
}

function hatCanvas(kind: HatId): HTMLCanvasElement {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) rows.push('.'.repeat(16))
  const put = (x: number, y: number, ch: string) => {
    if (y < 0 || y >= 16 || x < 0 || x >= 16) return
    rows[y] = rows[y]!.substring(0, x) + ch + rows[y]!.substring(x + 1)
  }
  switch (kind) {
    case 'none':
      break
    case 'bucket':
      for (let x = 4; x <= 11; x++) put(x, 1, 'C')
      for (let x = 4; x <= 11; x++) {
        put(x, 2, x === 4 || x === 11 ? 'C' : 'K')
      }
      put(3, 3, 'K')
      put(12, 3, 'K')
      break
    case 'snorkel':
      for (let x = 4; x <= 11; x++) put(x, 1, 'Y')
      for (let x = 4; x <= 11; x++) put(x, 2, 'Y')
      put(12, 0, 'R')
      put(12, 1, 'R')
      put(12, 2, 'R')
      put(12, 3, 'R')
      break
    case 'bandana':
      for (let x = 3; x <= 12; x++) put(x, 2, 'R')
      put(4, 3, 'R')
      put(11, 3, 'W')
      break
    case 'crown':
      for (let x = 5; x <= 10; x++) put(x, 3, 'Y')
      put(5, 1, 'Y')
      put(7, 0, 'Y')
      put(10, 1, 'Y')
      break
    case 'propeller':
      put(5, 0, 'R')
      put(10, 0, 'R')
      for (let x = 6; x <= 9; x++) put(x, 0, 'U')
      for (let x = 6; x <= 9; x++) put(x, 1, 'U')
      break
  }
  return paint(rows, 16, 16)
}

const GLYPHS: Record<string, string[]> = {
  A: ['0110', '1001', '1111', '1001', '1001', '1001'],
  B: ['1110', '1001', '1110', '1001', '1001', '1110'],
  C: ['0111', '1000', '1000', '1000', '1000', '0111'],
  D: ['1110', '1001', '1001', '1001', '1001', '1110'],
  E: ['1111', '1000', '1110', '1000', '1000', '1111'],
  F: ['1111', '1000', '1110', '1000', '1000', '1000'],
  G: ['0111', '1000', '1011', '1001', '1001', '0111'],
  H: ['1001', '1001', '1111', '1001', '1001', '1001'],
  I: ['111', '010', '010', '010', '010', '111'],
  J: ['0011', '0001', '0001', '1001', '1001', '0110'],
  K: ['1001', '1010', '1100', '1010', '1001', '1001'],
  L: ['1000', '1000', '1000', '1000', '1000', '1111'],
  M: ['1001', '1111', '1111', '1001', '1001', '1001'],
  N: ['1001', '1101', '1111', '1011', '1001', '1001'],
  O: ['0110', '1001', '1001', '1001', '1001', '0110'],
  P: ['1110', '1001', '1001', '1110', '1000', '1000'],
  Q: ['0110', '1001', '1001', '1011', '0111', '0001'],
  R: ['1110', '1001', '1001', '1110', '1010', '1001'],
  S: ['0111', '1000', '0110', '0001', '0001', '1110'],
  T: ['1111', '010', '010', '010', '010', '010'],
  U: ['1001', '1001', '1001', '1001', '1001', '0110'],
  V: ['1001', '1001', '1001', '1001', '0110', '0110'],
  W: ['1001', '1001', '1001', '1111', '1111', '0110'],
  X: ['1001', '1001', '0110', '0110', '1001', '1001'],
  Y: ['1001', '1001', '0110', '010', '010', '010'],
  Z: ['1111', '0001', '0010', '0100', '1000', '1111'],
  '0': ['0110', '1001', '1011', '1101', '1001', '0110'],
  '1': ['010', '110', '010', '010', '010', '111'],
  '2': ['0110', '1001', '0001', '0010', '0100', '1111'],
  '3': ['1110', '0001', '0110', '0001', '0001', '1110'],
  '4': ['0011', '0101', '1001', '1111', '0001', '0001'],
  '5': ['1111', '1000', '1110', '0001', '1001', '0110'],
  '6': ['0110', '1000', '1110', '1001', '1001', '0110'],
  '7': ['1111', '0001', '0010', '0100', '0100', '0100'],
  '8': ['0110', '1001', '0110', '1001', '1001', '0110'],
  '9': ['0110', '1001', '0111', '0001', '0001', '0110'],
  '#': ['0101', '1111', '0101', '0101', '1111', '0101'],
  '!': ['010', '010', '010', '010', '000', '010'],
  '?': ['0110', '1001', '0010', '0000', '010', '010'],
  '.': ['000', '000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '010', '100'],
  ':': ['000', '010', '000', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000', '000'],
  '+': ['000', '010', '111', '010', '000', '000'],
  '*': ['10101', '01010', '10101', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '11111'],
  '/': ['001', '001', '010', '100', '100', '100'],
  "'": ['010', '010', '000', '000', '000', '000'],
  '(': ['0010', '0100', '0100', '0100', '0100', '0010'],
  ')': ['0100', '0010', '0010', '0010', '0010', '0100'],
  '<': ['001', '010', '100', '100', '010', '001'],
  '>': ['100', '010', '001', '001', '010', '100'],
  '%': ['10001', '00010', '00100', '01000', '10001', '00000'],
  ' ': ['00', '00', '00', '00', '00', '00']
}

const fontCache = new Map<string, HTMLCanvasElement>()

export function fontCanvas(text: string): HTMLCanvasElement {
  const key = text.toUpperCase().slice(0, 48)
  const hit = fontCache.get(key)
  if (hit) return hit
  const c = cv(Math.max(1, key.length * 5), 6)
  const g = c.getContext('2d')!
  for (let i = 0; i < key.length; i++) {
    const glyph = GLYPHS[key[i]!] ?? GLYPHS['?']!
    for (let y = 0; y < glyph.length; y++) {
      const row = glyph[y] ?? ''
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '1') g.fillRect(i * 5 + x, y, 1, 1)
      }
    }
  }
  fontCache.set(key, c!)
  return c
}

// shadows/tinting --------------------------------------------------
const tintColorCache = new Map<HTMLCanvasElement, Map<string, HTMLCanvasElement>>()

export function tintCanvas(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let per = tintColorCache.get(src)
  if (!per) {
    per = new Map()
    tintColorCache.set(src, per)
  }
  const hit = per.get(color)
  if (hit) return hit
  const c = cv(src.width, src.height)
  const g = c.getContext('2d')!
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  per.set(color, c!)
  return c
}

export function drawText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  shadow = true,
  scale = 1
): void {
  const t = fontCanvas(text)
  if (shadow) {
    g.fillStyle = '#000000'
    g.fillRect(x + scale, y + scale, t.width, t.height)
    g.drawImage(tintCanvas(t, '#000000'), x + scale, y + scale)
  }
  if (scale === 1) {
    g.drawImage(tintCanvas(t, color), x, y)
  } else {
    g.imageSmoothingEnabled = false
    g.drawImage(tintCanvas(t, color), x, y, t.width * scale, t.height * scale)
  }
}

// game tiles ---------------------------------------------------------------
export interface TileSet {
  empty: HTMLCanvasElement
  boulder: HTMLCanvasElement
  castle: HTMLCanvasElement
  flood: HTMLCanvasElement
  border: HTMLCanvasElement
}

export function genTileset(theme: MapTheme): TileSet {
  const mk = (fn: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = cv(16, 16)
    const g = c.getContext('2d')!
    fn(g)
    return c
  }
  let ground = theme === 'beach' ? '#e2cd8f' : theme === 'pool' ? '#5fc0d4' : '#3f9142'
  const ground2 = theme === 'beach' ? '#d7bd7a' : theme === 'pool' ? '#50b1c4' : '#47a34b'
  let rock = '#5a6c86'
  const rock2 = '#3e4c63'
  let castle = '#d9b36c'
  const castle2 = '#b98f4e'
  let edge = theme === 'beach' ? '#7a5a3a' : theme === 'pool' ? '#7f8fa8' : '#6b4a2f'
  let water = '#2f6bd8'
  const water2 = '#3a80ef'
  if (theme === 'pool') {
    ground = '#5fc0d4'
    rock = '#4fa8c8'
    castle = '#8fc8d8'
    edge = '#7f8fa8'
    water = '#2f6bd8'
  }
  return {
    empty: mk((g) => {
      g.fillStyle = ground
      g.fillRect(0, 0, 16, 16)
      g.fillStyle = ground2
      for (let j = 0; j < 16; j++)
        for (let k = 0; k < 16; k++) if ((k * 7 + j * 5 + ((j * k) % 3)) % 9 === 0) g.fillRect(k, j, 1, 1)
    }),
    boulder: mk((g) => {
      g.fillStyle = rock
      g.fillRect(1, 1, 14, 14)
      g.fillStyle = rock2
      for (let j = 2; j < 14; j++) for (let k = 2; k < 14; k++) if ((k + j) % 5 === 0) g.fillRect(k, j, 1, 1)
      g.fillStyle = rock
      g.fillRect(3, 3, 10, 3)
    }),
    castle: mk((g) => {
      g.fillStyle = castle
      g.fillRect(0, 2, 16, 12)
      g.fillStyle = castle2
      g.fillRect(0, 2, 16, 2)
      g.fillRect(4, 5, 2, 9)
      g.fillRect(10, 5, 2, 9)
      g.fillRect(6, 8, 4, 1)
      g.fillStyle = '#f2d9a4'
      g.fillRect(1, 2, 2, 1)
      g.fillRect(13, 2, 2, 1)
    }),
    flood: mk((g) => {
      g.fillStyle = water
      g.fillRect(0, 0, 16, 16)
      g.fillStyle = water2
      for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) if ((k * 3 + j * 2) % 7 === 0) g.fillRect(k, j, 1, 1)
      g.fillStyle = '#bfe9ff'
      g.fillRect(2, 4, 3, 1)
      g.fillRect(9, 10, 4, 1)
    }),
    border: mk((g) => {
      g.fillStyle = edge
      g.fillRect(0, 0, 16, 16)
      g.fillStyle = '#00000022'
      for (let j = 0; j < 16; j += 4) g.fillRect(0, j, 16, 2)
    })
  }
}

function powerupIcon(type: PowerupType): HTMLCanvasElement {
  const arts: Record<PowerupType, string[]> = {
    extra_balloon: ['.WWWW.', 'WRRRRW', 'WRRRRW', '.WWWW.', '..KK..', '...KK.'],
    big_splash: ['B.B.B', '.BBB.', 'WWWWW', '.BBB.', 'B.B.B', '.....'],
    flippers: ['CC.C', 'CCCC', 'RRRC', 'CCCC', '....', '....'],
    boots: ['EE.E', 'EE.E', 'EEE.', 'EEE.', 'YY..', '....']
  }
  return paint(arts[type]!, 6, 6)
}

export interface Sprites {
  animals: Record<string, AnimalFrames>
  hats: Record<string, HTMLCanvasElement>
  powerups: Record<PowerupType, HTMLCanvasElement>
  balloon: HTMLCanvasElement[]
  splashCenter: HTMLCanvasElement[]
  splashArm: HTMLCanvasElement[]
  duck: HTMLCanvasElement[]
  emotes: HTMLCanvasElement[]
}

function balloonFrames(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = []
  for (let f = 0; f < 3; f++) {
    const c = cv(14, 16)
    const g = c.getContext('2d')!
    const w = 8 + f * 2
    const h = 10 + f * 2
    const x0 = Math.floor(7 - w / 2)
    const y0 = 15 - h
    const col = f === 2 ? '#f4f4fa' : f === 1 ? '#e8e8f2' : '#dcdcea'
    g.fillStyle = col
    g.beginPath()
    g.arc(7, y0 + Math.floor(h / 2), Math.ceil(w / 2), 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffffff'
    g.fillRect(x0 + 2, y0 + 2, 2, 2)
    g.fillStyle = '#5a6c86'
    g.fillRect(6, y0 + h, 2, 1)
    frames.push(c)
  }
  return frames
}

function splashFrameSets(): { center: HTMLCanvasElement[]; arm: HTMLCanvasElement[] } {
  const storeColors = () => PAL
  void storeColors
  const center: HTMLCanvasElement[] = []
  const arm: HTMLCanvasElement[] = []
  for (let f = 0; f < 4; f++) {
    const grow = [5, 8, 11, 13][f]!
    const c = cv(16, 16)
    const g = c.getContext('2d')!
    g.fillStyle = '#7ec9ff'
    g.fillRect(8 - Math.floor(grow / 2), 8 - Math.floor(grow / 2), grow, grow)
    g.fillStyle = '#e8f7ff'
    g.fillRect(8 - Math.floor(grow / 2), 8 - Math.floor(grow / 2), 1, 1)
    center.push(c)
    const a = cv(16, 16)
    const ga = a.getContext('2d')!
    const h = 6 + f * 2
    ga.fillStyle = '#7ec9ff'
    ga.fillRect(3, 8 - Math.floor(h / 2), 11, h)
    ga.fillStyle = '#e8f7ff'
    ga.fillRect(3, 8 - Math.floor(h / 2), 11, 1)
    arm.push(a)
  }
  return { center, arm }
}

function duckSprites(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = []
  for (let f = 0; f < 2; f++) {
    const c = cv(14, 12)
    const g = c.getContext('2d')!
    const bob = f
    g.fillStyle = '#ffd23f'
    g.fillRect(3, 4 + bob, 8, 5)
    g.fillRect(2, 6 + bob, 3, 2)
    g.fillStyle = '#ffb43f'
    g.fillRect(9, 2 + bob, 3, 2)
    g.fillStyle = '#0e0e24'
    g.fillRect(9, 3 + bob, 1, 1)
    g.fillStyle = '#ff8d2e'
    g.fillRect(1, 9 + bob, 12, 1)
    out.push(c)
  }
  return out
}

function emoteSprites(): HTMLCanvasElement[] {
  const mk = (fn: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = cv(14, 13)
    const g = c.getContext('2d')!
    g.fillStyle = 'rgba(250,250,255,0.95)'
    g.fillRect(0, 0, 14, 12)
    g.fillStyle = PAL.K
    g.fillRect(4, 12, 3, 1)
    fn(g)
    return c
  }
  return [
    mk((g) => {
      g.fillStyle = PAL.Y
      g.fillRect(3, 3, 8, 6)
      g.fillStyle = PAL.O
      g.fillRect(11, 5, 2, 2)
      g.fillStyle = PAL.K
      g.fillRect(5, 5, 1, 1)
      g.fillRect(8, 5, 1, 1)
    }),
    mk((g) => {
      g.fillStyle = PAL.G
      g.fillRect(3, 3, 8, 6)
      g.fillStyle = PAL.K
      g.fillRect(5, 5, 2, 1)
      g.fillRect(8, 5, 2, 1)
      g.fillRect(6, 8, 2, 1)
    }),
    mk((g) => {
      g.fillStyle = PAL.C
      g.fillRect(3, 3, 8, 6)
      g.fillStyle = PAL.K
      g.fillRect(5, 4, 1, 2)
      g.fillRect(8, 4, 1, 2)
      g.fillRect(6, 7, 2, 2)
    }),
    mk((g) => {
      g.fillStyle = PAL.P
      g.fillRect(3, 2, 8, 8)
      g.fillStyle = PAL.K
      g.fillRect(4, 5, 2, 2)
      g.fillRect(8, 5, 2, 2)
      g.fillStyle = PAL.W
      g.fillRect(4, 9, 6, 1)
    })
  ]
}

export function buildSprites(): Sprites {
  return {
    animals: buildAnimalSprites(),
    hats: buildHatSprites(),
    powerups: {
      extra_balloon: powerupIcon('extra_balloon'),
      big_splash: powerupIcon('big_splash'),
      flippers: powerupIcon('flippers'),
      boots: powerupIcon('boots')
    },
    balloon: balloonFrames(),
    splashCenter: splashFrameSets().center,
    splashArm: splashFrameSets().arm,
    duck: duckSprites(),
    emotes: emoteSprites()
  }
}

export function buildAnimalSprites(): Record<string, AnimalFrames> {
  const kinds: AnimalId[] = ['frog', 'duck', 'otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara']
  const out: Record<string, AnimalFrames> = {}
  for (const a of kinds) {
    out[a] = {
      a: animalCanvas(a, 0, false),
      b: animalCanvas(a, 1, false),
      soak: animalCanvas(a, 0, true)
    }
  }
  return out
}

export function buildHatSprites(): Record<string, HTMLCanvasElement> {
  const hats: HatId[] = ['none', 'bucket', 'snorkel', 'bandana', 'crown', 'propeller']
  const out: Record<string, HTMLCanvasElement> = {}
  for (const h of hats) out[h] = hatCanvas(h)
  return out
}

export function themeTiles(theme: MapTheme): Record<number, HTMLCanvasElement> {
  const ts = genTileset(theme)
  return {
    [TILE.EMPTY]: ts.empty,
    [TILE.BOULDER]: ts.boulder,
    [TILE.CASTLE]: ts.castle,
    [TILE.FLOOD]: ts.flood,
    99: ts.border
  }
}

