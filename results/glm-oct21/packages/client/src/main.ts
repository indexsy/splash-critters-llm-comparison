import type { C2S, S2C, RoomInfo, PlayerProfile } from '@splash/shared'
import { Net } from './net'
import { buildSprites, buildAnimalSprites, buildHatSprites, type Sprites } from './render/sprites'
import { Music } from './audio'

export interface Screen {
  enter?(): void
  update(dt: number): void
  draw(g: CanvasRenderingContext2D): void
  onKey?(key: string, down: boolean): void
  onMsg?(msg: S2C): void
  leaves?(): void
}

const KEYMAP_BASE: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'balloon',
  ' ': 'balloon',
  Enter: 'confirm',
  Escape: 'back',
  KeyM: 'mute',
  Digit1: 'emote1',
  Digit2: 'emote2',
  Digit3: 'emote3',
  Digit4: 'emote4'
}

export interface Keybinds {
  [action: string]: string
}

export const Store: {
  net: Net | null
  sprites: Sprites
  animals: ReturnType<typeof buildAnimalSprites>
  hats: ReturnType<typeof buildHatSprites>
  binds: Keybinds
  muted: boolean
  colorblind: boolean
  shake: boolean
  flash: boolean
  tutorialDone: boolean
  hash: string
  toastText: string
  toastUntil: number
  roomList: RoomInfo[]
} = {
  net: null,
  sprites: null as unknown as Sprites,
  animals: null as unknown as ReturnType<typeof buildAnimalSprites>,
  hats: null as unknown as ReturnType<typeof buildHatSprites>,
  binds: {},
  muted: false,
  colorblind: false,
  shake: false,
  flash: false,
  tutorialDone: localStorage.getItem('sc_tutorial_done') === '1',
  hash: '',
  toastText: '',
  toastUntil: 0,
  roomList: []
}

function loadBinds(): void {
  const stored = localStorage.getItem('sc_binds')
  if (stored) {
    try {
      Store.binds = JSON.parse(stored) as Keybinds
      return
    } catch {
      /* fallthrough */
    }
  }
  Store.binds = { ...KEYMAP_BASE }
}

export function saveBinds(): void {
  localStorage.setItem('sc_binds', JSON.stringify(Store.binds))
}

function normalize(code: string): string {
  return code
}

const PRESENT = new Set<string>()

export function actionFor(code: string): string | null {
  for (const [act, kc] of Object.entries(Store.binds)) {
    if (kc === normalize(code)) return act
  }
  return null
}

export function isDown(action: string): boolean {
  for (const [act, kc] of Object.entries(Store.binds)) {
    if (act === action && PRESENT.has(kc)) return true
  }
  return false
}

export function clearInput(): void {
  PRESENT.clear()
}

export interface ScreenManager {
  push(s: Screen): void
  pop(): void
  replace(s: Screen): void
  top(): Screen | undefined
  all(): Screen[]
}

const stack: Screen[] = []

export const Screens: ScreenManager = {
  push(s: Screen) {
    stack.push(s)
    s.enter?.()
  },
  pop() {
    const s = stack.pop()
    s?.leaves?.()
  },
  replace(s: Screen) {
    const old = stack.pop()
    old?.leaves?.()
    stack.push(s)
    s.enter?.()
  },
  top() {
    return stack[stack.length - 1]
  },
  all() {
    return stack
  }
}

export function dispatchMsg(msg: S2C): void {
  for (const sc of [...stack].reverse()) {
    sc.onMsg?.(msg)
  }
}

export interface App {
  canvas: HTMLCanvasElement
  g: CanvasRenderingContext2D
  net: Net
}

let app: App | null = null

export function boot(canvas: HTMLCanvasElement, net: Net): void {
  app = { canvas, g: canvas.getContext('2d')!, net }
  Store.net = net
  Store.sprites = buildSprites()
  Store.animals = buildAnimalSprites()
  Store.hats = buildHatSprites()
  loadBinds()
  Store.muted = localStorage.getItem('sc_muted') === '1'
  Store.colorblind = localStorage.getItem('sc_colorblind') === '1'
  Store.shake = localStorage.getItem('sc_shake') !== '0'
  Store.flash = localStorage.getItem('sc_flash') !== '0'

  window.addEventListener('keydown', (e) => {
    const code = normalize(e.code || String(e.key))
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault()
    if (PRESENT.has(code)) return
    PRESENT.add(code)
    const s = Screens.top()
    const act = actionFor(code)
    if (act === 'mute') {
      Store.muted = !Store.muted
      localStorage.setItem('sc_muted', Store.muted ? '1' : '0')
      void import('./audio').then((m) => m.applySettings())
      return
    }
    s?.onKey?.(code, true)
  })
  window.addEventListener('keyup', (e) => {
    const code = normalize(e.code || String(e.key))
    PRESENT.delete(code)
    const s = Screens.top()
    s?.onKey?.(code, false)
  })
  window.addEventListener('blur', () => PRESENT.clear())

  let last = performance.now()
  const loop = (now: number) => {
    requestAnimationFrame(loop)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const g = app!.g
    g.imageSmoothingEnabled = false
    for (const s of stack) s.update(dt)
    const top = Screens.top()
    void top
    // clear
    g.fillStyle = '#0b1030'
    g.fillRect(0, 0, 256, 224)
    if (stack.length > 0) {
      stack[stack.length - 1]!.draw(g)
    }
  }
  requestAnimationFrame(loop)

  const route = () => {
    Store.hash = location.hash
    void import('./screens').then((m) => m.route())
  }
  window.addEventListener('hashchange', route)
  route()
}

export function net(): Net {
  return app!.net
}

export function goHash(h: string): void {
  location.hash = h
}

export function send(msg: C2S): void {
  Store.net?.send(msg)
}

export function playMusic(kind: 'title' | 'menu' | 'lobby' | 'match' | 'showdown' | 'results'): void {
  Music.play(kind)
}
