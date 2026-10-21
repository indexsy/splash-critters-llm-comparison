import { CONFIG, TILE, predictStep } from '@splash/shared'
import type { Dir, SimEvent, Snapshot, S2C, PlayerProfile, GameMode, EmoteId } from '@splash/shared'
import { Store, send, playMusic, isDown, actionFor, type Screen } from '../main'
import { Sfx, Music } from '../audio'
import { Feed, drawHudStrip } from '../render/hud'
import { Particles } from '../render/particles'
import { themeTiles, drawText, fontCanvas, cv, PAL } from '../render/sprites'
import { toastFlash } from './index'

interface RemoteEnt {
  x: number
  y: number
  prevX: number
  prevY: number
  recvAt: number
}

export interface MatchResultInfo {
  mode: GameMode
  meta: string
  places: Array<{ id: number; nickname: string; animal: string; hat: string; placement: number; roundsWon: number; soaks: number; isBot: boolean; award?: string }>
  meId: number
  xp?: { gained: number; total: number; leveledUp: boolean }
  rating?: { before: number; after: number; delta: number; tier: string; peak: number }
  myRoundsWon: number
  mySoaks: number
}

export type MatchKind = 'ranked' | 'casual' | 'practice' | 'tutorial'

const CHAIN_NAMES = ['DOUBLE SPLASH!', 'TRIPLE SPLASH!', 'MEGA SOAK!!']

function decodeGrid(b64: string, W: number, H: number): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(W * H)
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function nicePU(t: string): string {
  switch (t) {
    case 'extra_balloon':
      return '+1 balloon'
    case 'big_splash':
      return 'BIG range +1'
    case 'flippers':
      return 'speed UP!'
    case 'boots':
      return 'boot kick!'
    default:
      return t
  }
}

function emoteSprite(i: number): HTMLCanvasElement {
  const c = cv(14, 13)
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(250,250,255,0.95)'
  g.fillRect(0, 0, 14, 12)
  g.fillStyle = PAL.K
  g.fillRect(4, 12, 3, 1)
  switch (i) {
    case 0:
      g.fillStyle = PAL.Y
      g.fillRect(3, 3, 8, 6)
      g.fillStyle = PAL.O
      g.fillRect(11, 5, 2, 2)
      g.fillStyle = PAL.K
      g.fillRect(5, 5, 1, 1)
      g.fillRect(8, 5, 1, 1)
      break
    case 1:
      g.fillStyle = PAL.G
      g.fillRect(3, 3, 8, 6)
      g.fillStyle = PAL.K
      g.fillRect(5, 5, 2, 1)
      g.fillRect(8, 5, 2, 1)
      g.fillRect(6, 8, 2, 1)
      break
    case 2:
      g.fillStyle = PAL.C
      g.fillRect(3, 3, 8, 6)
      g.fillStyle = PAL.K
      g.fillRect(5, 4, 1, 2)
      g.fillRect(8, 4, 1, 2)
      g.fillRect(6, 7, 2, 2)
      break
    default:
      g.fillStyle = PAL.P
      g.fillRect(3, 2, 8, 8)
      g.fillStyle = PAL.K
      g.fillRect(4, 5, 2, 2)
      g.fillRect(8, 5, 2, 2)
      g.fillStyle = PAL.W
      g.fillRect(4, 9, 6, 1)
      break
  }
  return c
}

const TINT_CACHE = new Map<string, HTMLCanvasElement>()
function tintKey(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const key = `t:${src.width}x${src.height}:${color}`
  let c = TINT_CACHE.get(key)
  if (c) return c
  c = cv(src.width, src.height)
  const g = c.getContext('2d')!
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  TINT_CACHE.set(key, c!)
  return c
}

export class GameScreen implements Screen {
  kind: MatchKind = 'casual'
  mode: GameMode = 'duel'
  myId = -1
  snap: Snapshot | null = null
  simTick = 0
  tickAcc = 0
  local: { x: number; y: number; facing: Dir; id: number; speed: number } = { x: 14, y: 14, facing: 'down', id: -1, speed: 4 }
  remotes = new Map<number, RemoteEnt>()
  balloons: Array<{ id: number; tx: number; ty: number; fuse: number; fuseMax: number; owner: number }> = []
  grid: Uint8Array = new Uint8Array(0)
  W = 13
  H = 11
  theme: 'backyard' | 'beach' | 'pool' = 'backyard'
  tiles: Record<number, HTMLCanvasElement> | null = null
  feedNew = new Feed()
  particles = new Particles()
  emotesShown = new Map<number, { id: number; until: number }>()
  roundWins: Record<number, number> = {}
  phase: 'intro' | 'countdown' | 'live' | 'roundEnd' | 'matchEnd' = 'intro'
  countdown = 0
  roundIndex = 0
  roundsToWin = 3
  maxChainSeen = 0
  shakeTime = 0
  emoteCd = 0
  pingAcc = 2.5
  lastResult: MatchResultInfo | null = null
  resultsHandled = false
  tutorialHint = ''
  tutorialStep = 0
  emoteSprites = [emoteSprite(0), emoteSprite(1), emoteSprite(2), emoteSprite(3)]

  begin(kind: MatchKind, profile: PlayerProfile | null, mode: GameMode): void {
    void profile
    this.kind = kind
    this.mode = mode
    this.myId = -1
    this.snap = null
    this.remotes.clear()
    this.particles.clear()
    this.feedNew = new Feed()
    this.emotesShown.clear()
    this.roundWins = {}
    this.phase = 'intro'
    this.countdown = 1.2
    this.roundIndex = 0
    this.lastResult = null
    this.resultsHandled = false
    this.maxChainSeen = 0
    this.tutorialStep = kind === 'tutorial' ? 0 : 99
    this.tutorialHint = kind === 'tutorial' ? 'MASTER THE SPLASH TUTORIAL!' : ''
    playMusic('match')
  }

  isActive(): boolean {
    return this.phase === 'live' && this.snap !== null
  }

  onExit(): void {
    this.snap = null
    Music.stop()
  }

  onKey(code: string, down: boolean): void {
    if (!down) return
    const act = actionFor(code)
    if (act === 'back' && (this.phase === 'roundEnd' || this.phase === 'matchEnd')) {
      send({ t: 'leave_room' })
      this.onExit()
      void import('./index').then((m) => m.ScreensReplaceMenu())
    }
  }

  onMsg(msg: S2C): void {
    switch (msg.t) {
      case 'match_start': {
        this.roundsToWin = msg.config.roundsToWin
        const mine = msg.config.players.find((p) => p.playerId === (Store.net?.profile?.id ?? ''))
        this.myId = mine?.slot ?? 0
        this.phase = 'countdown'
        this.countdown = 2.0
        this.feedNew.announce('MATCH START', true)
        Music.play('match')
        break
      }
      case 'round_start': {
        this.W = msg.W
        this.H = msg.H
        this.theme = msg.theme
        this.tiles = themeTiles(msg.theme)
        this.grid = decodeGrid(msg.castleGridB64, this.W, this.H)
        this.roundIndex = msg.roundNo
        this.phase = 'countdown'
        this.countdown = 2.6
        this.particles.clear()
        this.feedNew.announce(`ROUND ${this.roundIndex}`, true)
        const spawnTup = msg.spawns[this.myId] ?? msg.spawns[0]!
        this.local = { x: spawnTup[0] + 0.5, y: spawnTup[1] + 0.5, facing: 'down', id: this.myId, speed: 4 }
        this.remotes.clear()
        this.balloons = []
        break
      }
      case 'snapshot': {
        this.applySnapshot(msg.snap)
        break
      }
      case 'events': {
        this.applyEvents(msg.events)
        break
      }
      case 'emote_b': {
        this.emotesShown.set(msg.playerId, { id: msg.id, until: performance.now() + 2200 })
        Sfx.emote(msg.id)
        break
      }
      case 'round_end': {
        this.phase = 'roundEnd'
        this.countdown = 3.0
        for (const sc of msg.scores) this.roundWins[sc.id] = sc.roundsWon
        const won = msg.winnerIds.includes(this.myId)
        if (won) {
          Sfx.roundWin()
          this.feedNew.announce('YOU WIN THE ROUND!', true)
        } else {
          this.feedNew.announce(msg.draw ? 'ROUND IS A DRAW' : `${this.nameOf(msg.winnerIds[0] ?? -1)} WINS THE ROUND`, true)
        }
        break
      }
      case 'round_cancel': {
        this.feedNew.announce(`CANCELLED (${msg.reason})`, true)
        break
      }
      case 'match_end': {
        this.lastResult = {
          mode: this.mode,
          meta: msg.matchId ?? '',
          places: msg.placements.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            animal: (this.snap?.players.find((q) => q.id === p.id)?.animal ?? 'frog'),
            hat: (this.snap?.players.find((q) => q.id === p.id)?.hat ?? 'none'),
            placement: p.placement,
            roundsWon: p.roundsWon,
            soaks: p.soaks,
            isBot: p.isBot,
            award: p.award
          })),
          meId: this.myId,
          xp: msg.xp,
          rating: msg.rating,
          myRoundsWon: msg.placements.find((p) => p.id === this.myId)?.roundsWon ?? 0,
          mySoaks: msg.placements.find((p) => p.id === this.myId)?.soaks ?? 0
        }
        this.phase = 'matchEnd'
        this.countdown = 2.6
        Sfx.fanfare()
        break
      }
      default:
        break
    }
  }

  nameOf(id: number): string {
    if (id === this.myId) return 'You'
    return this.snap?.players.find((p) => p.id === id)?.nickname ?? '??'
  }

  applyEvents(events: SimEvent[]): void {
    let chainMax = 0
    for (const e of events) {
      switch (e.t) {
        case 'balloon_kicked':
          Sfx.kick()
          break
        case 'chain_burst':
          chainMax = Math.max(chainMax, e.depth)
          break
        case 'castle_washed': {
          const idx = e.y * this.W + e.x
          if (this.grid[idx] === TILE.CASTLE) this.grid[idx] = TILE.EMPTY
          this.particles.spawnCrumble(e.x * 16, e.y * 16)
          Sfx.burst()
          break
        }
        case 'powerup_revealed':
          Sfx.reveal()
          break
        case 'powerup_collected': {
          Sfx.pickup()
          if (e.playerId === this.myId) this.feedNew.push(`Got ${nicePU(e.type)}!`)
          else this.feedNew.push(`${this.nameOf(e.playerId)} got ${nicePU(e.type)}`)
          break
        }
        case 'player_soaked': {
          Sfx.soaked()
          if (e.playerId === this.myId) {
            this.shakeTime = 0.35
            this.feedNew.push(`Soaked by ${e.by >= 0 ? this.nameOf(e.by) : e.by === -1 ? 'the tide' : 'a duck'}!`)
          } else {
            this.feedNew.push(`${e.by >= 0 ? this.nameOf(e.by) : e.by === -1 ? 'Tide' : 'Duck'} soaked ${this.nameOf(e.playerId)}`)
          }
          break
        }
        case 'tide_advance': {
          Sfx.tide()
          this.feedNew.announce(e.ring === 0 ? 'THE TIDE RISES!' : 'TIDE ADVANCES!')
          break
        }
        case 'revenge_lob':
          Sfx.duck()
          this.feedNew.push('A duck lobs revenge!')
          break
        default:
          break
      }
    }
    if (chainMax >= 2) {
      Sfx.chain(chainMax)
      this.maxChainSeen = Math.max(this.maxChainSeen, chainMax)
      this.feedNew.announce(CHAIN_NAMES[Math.min(2, chainMax - 1)]!, true)
    }
    this.tutorialAdvance()
  }

  tutorialAdvance(): void {
    if (this.tutorialStep > 90 || this.kind !== 'tutorial') return
    if (this.tutorialStep === 0) {
      this.tutorialHint = 'MOVE WITH WASD! FIND A BALLOON + PICK UP!'
      this.tutorialStep = 1
    } else if (this.tutorialStep === 1) {
      this.tutorialHint = 'GOT A POWERUP! NOW DROP A BALLOON (SPACE)!'
      this.tutorialStep = 2
    } else if (this.tutorialStep === 2) {
      this.tutorialHint = 'WASH THE CASTLE 2x2 - THEN GO SOAK THE BOT!'
      this.tutorialStep = 3
    }
  }

  currentDir(): Dir {
    if (isDown('left')) return 'left'
    if (isDown('right')) return 'right'
    if (isDown('up')) return 'up'
    if (isDown('down')) return 'down'
    return 'none'
  }

  applySnapshot(snap: Snapshot): void {
    this.balloons = snap.balloons.map((b) => ({ id: b.id, tx: Math.round(b.x), ty: Math.round(b.y), fuse: b.fuse, fuseMax: b.fuseMax, owner: b.owner }))
    const me = snap.players.find((p) => p.id === this.myId)
    if (me) {
      const far = Math.abs(me.x - this.local.x) + Math.abs(me.y - this.local.y)
      if (far > 1.2) {
        this.local.x = me.x
        this.local.y = me.y
      } else {
        this.local.x = this.local.x * 0.86 + me.x * 0.14
        this.local.y = this.local.y * 0.86 + me.y * 0.14
      }
    }
    const nowMs = performance.now()
    for (const p of snap.players) {
      if (p.id === this.myId) continue
      const r = this.remotes.get(p.id)
      if (!r) {
        this.remotes.set(p.id, { x: p.x, y: p.y, prevX: p.x, prevY: p.y, recvAt: nowMs })
        continue
      }
      r.prevX = r.x
      r.prevY = r.y
      r.x = p.x
      r.y = p.y
      r.recvAt = nowMs
    }
    for (const k of this.remotes.keys()) {
      if (!snap.players.some((q) => q.id === k)) this.remotes.delete(k)
    }
    for (const p of snap.players) {
      if (this.roundWins[p.id] === undefined) this.roundWins[p.id] = p.roundsWon
    }
    this.snap = snap
  }

  update(dt: number): void {
    this.particles.update(dt)
    this.feedNew.update(dt)
    if (this.shakeTime > 0) this.shakeTime -= dt

    this.pingAcc += dt
    if (this.pingAcc > 4) {
      this.pingAcc = 0
    }

    const nowMs = performance.now()
    for (const [id, em] of this.emotesShown) if (nowMs > em.until) this.emotesShown.delete(id)

    switch (this.phase) {
      case 'countdown': {
        const before = Math.ceil(this.countdown)
        this.countdown -= dt
        const after = Math.ceil(this.countdown)
        if (before !== after && after >= 0 && after <= 3) {
          this.feedNew.announce(after > 0 ? `${after}...` : 'SPLASH!', after === 0)
          Sfx.blip()
        }
        if (this.countdown <= 0) {
          this.phase = 'live'
          this.simTick = 0
        }
        break
      }
      case 'live': {
        this.tickAcc += dt
        let steps = 0
        while (this.tickAcc >= CONFIG.TICK_MS && steps < 3) {
          this.tickAcc -= CONFIG.TICK_MS
          steps++
          this.simTick++
          const dir = this.currentDir()
          const balloonPressed = isDown('balloon')
          const blocky = this.balloons.map((b) => ({ tx: b.tx, ty: b.ty, ownerId: b.owner }))
          this.local.id = this.myId
          predictStep(this.grid, this.W, this.H, blocky, this.local, dir)
          send({ t: 'input', seq: this.simTick, tick: this.simTick, dir, balloon: balloonPressed })
          for (let em = 0; em < 4; em++) {
            if (isDown(`emote${em + 1}`)) this.sendEmote(em)
          }
        }
        if (this.tickAcc > 0.5) this.tickAcc = 0
        break
      }
      case 'roundEnd': {
        this.countdown -= dt
        break
      }
      case 'matchEnd': {
        this.countdown -= dt
        if (this.countdown <= 0 && !this.resultsHandled) {
          this.resultsHandled = true
          void import('./index').then((m) => m.pushResults())
        }
        break
      }
      default:
        break
    }
  }

  sendEmote(id: number): void {
    if (performance.now() < this.emoteCd) return
    this.emoteCd = performance.now() + 900
    this.emotesShown.set(this.myId, { id, until: performance.now() + 2200 })
    send({ t: 'emote', id: (id < 0 ? 0 : id) as EmoteId })
    Sfx.emote(id)
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#111528'
    g.fillRect(0, 0, 256, 224)
    if (!this.tiles || !this.snap) {
      drawText(g, 'WAITING FOR ROUND DATA...', 40, 108, '#7ec9ff', true, 1)
      return
    }
    let ox = 0
    let oy = 0
    if (this.shakeTime > 0) {
      ox = Math.round((Math.random() - 0.5) * 3)
      oy = Math.round((Math.random() - 0.5) * 3)
    }
    g.save()
    g.translate(ox, oy)
    const gx = Math.round((256 - this.W * 16) / 2)
    const gy = 44
    if (this.snap.tide > 0) {
      g.fillStyle = 'rgba(58,128,239,0.16)'
      g.fillRect(0, 0, 256, 224)
    }
    this.drawTiles(g, gx, gy)
    this.drawPowerups(g, gx, gy)
    this.drawSplashSet(g, gx, gy)
    this.drawBalloons(g, gx, gy)
    this.drawDucks(g, gx, gy)
    this.drawPlayers(g, gx, gy)
    this.particles.draw(g)
    this.drawEmoteBubbles(g, gx, gy)
    g.restore()

    drawHudStrip(g, this.snap, this.myId, this.roundWins)
    this.feedNew.draw(g)
    if (this.phase === 'countdown') {
      const n = Math.max(0, Math.ceil(this.countdown))
      drawText(g, `${n}`, 118, 96, PAL.Y, true, 4)
    }
    if (this.tutorialHint) {
      g.fillStyle = 'rgba(8,10,25,0.85)'
      g.fillRect(10, 200, 236, 14)
      const img = tintKey(StoreFont(this.tutorialHint.slice(0, 42)), '#ffe9a3')
      g.drawImage(img, 14, 204)
    }
  }

  drawTiles(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    const T = this.tiles!
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const t = this.grid[y * this.W + x]!
        const img = t === TILE.BOULDER ? T[TILE.BOULDER]! : t === TILE.CASTLE ? T[TILE.CASTLE]! : t === TILE.FLOOD ? T[TILE.FLOOD]! : T[TILE.EMPTY]!
        g.drawImage(img, gx + x * 16, gy + y * 16)
      }
    }
  }

  drawPowerups(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    if (!this.snap) return
    const t = performance.now() / 1000
    for (const pu of this.snap.powerups) {
      const icon = Store.sprites.powerups[pu.type]
      if (!icon) continue
      const bob = Math.round(Math.sin(t * 4 + pu.x) * 1)
      g.drawImage(icon, gx + pu.x * 16 + 5, gy + pu.y * 16 + 4 + bob)
    }
  }

  drawSplashSet(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    if (!this.snap) return
    const f = Math.floor(performance.now() / 90) % Store.sprites.splashCenter.length
    const center = Store.sprites.splashCenter[f]!
    const arm = Store.sprites.splashArm[f]!
    for (const s of this.snap.splashes) {
      for (let i = 0; i < s.cells.length; i += 2) {
        const cxx = s.cells[i]!
        const cyy = s.cells[i + 1]!
        g.drawImage(i === 0 ? center : arm, gx + cxx * 16, gy + cyy * 16)
      }
    }
  }

  drawBalloons(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    for (const b of this.balloons) {
      const ratio = b.fuse / Math.max(1, b.fuseMax)
      const frame = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2
      const img = Store.sprites.balloon[frame]!
      const wob = Math.sin(performance.now() / (ratio < 0.4 ? 50 : 110)) * (ratio < 0.4 ? 1.4 : 0.7)
      g.drawImage(img, gx + b.tx * 16 + 1 + Math.round(wob), gy + b.ty * 16 - 2)
    }
  }

  drawDucks(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    if (!this.snap) return
    const f = Math.floor(performance.now() / 130) % Store.sprites.duck.length
    for (const d of this.snap.ducks) {
      g.drawImage(Store.sprites.duck[f]!, gx + Math.floor(d.x * 16) - 2, gy + Math.floor(d.y * 16) - 3)
    }
  }

  drawPlayers(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    const snap = this.snap
    if (!snap) return
    const nowMs = performance.now()
    for (const p of snap.players) {
      if (p.id === this.myId) continue
      const r = this.remotes.get(p.id)
      const k = r ? Math.min(1, (nowMs - r.recvAt + 16) / CONFIG.TICK_MS * 4) : 1
      const w = (a: number, b: number) => (r ? a : b) as number
      const x = r ? r.prevX + (r.x - r.prevX) * k : w(p.x, p.x)
      const y = r ? r.prevY + (r.y - r.prevY) * k : w(p.y, p.y)
      this.critter(g, p.id, gx + Math.floor(x * 16), gy + Math.floor(y * 16), snap, Math.floor(nowMs / 140) % 2)
    }
    const me = snap.players.find((p) => p.id === this.myId)
    if (me) {
      const moving = isDown('left') || isDown('right') || isDown('up') || isDown('down')
      this.critter(g, this.myId, gx + Math.floor(this.local.x * 16), gy + Math.floor(this.local.y * 16), snap, moving || me.alive === false ? Math.floor(nowMs / 140) % 2 : 0)
    }
  }

  critter(g: CanvasRenderingContext2D, id: number, px: number, py: number, snap: Snapshot, frame: number): void {
    const meta = snap.players.find((p) => p.id === id)
    if (!meta) return
    const frames = Store.animals[meta.animal] ?? Store.animals['frog']!
    const img = meta.alive ? (frame % 2 === 1 ? frames.b : frames.a) : frames.soak
    const x = px - 8
    const y = py - 10
    g.drawImage(img, x, y)
    if (meta.hat !== 'none') {
      const h = Store.hats[meta.hat]
      if (h) g.drawImage(h, x, y)
    }
    const nm = meta.nickname.slice(0, 7).toUpperCase()
    if (nm) {
      const f = StoreFont(nm)
      const bgx = Math.round(px - f.width / 2)
      g.fillStyle = 'rgba(8,10,25,0.65)'
      g.fillRect(bgx, y - 7, f.width + 2, 6)
      g.drawImage(tintKey(f, id === this.myId ? '#ffd23f' : '#ffffff'), bgx + 1, y - 6)
    }
  }

  drawEmoteBubbles(g: CanvasRenderingContext2D, gx: number, gy: number): void {
    const nowMs = performance.now()
    for (const [id, em] of this.emotesShown) {
      if (nowMs > em.until) continue
      const p = this.snap?.players.find((q) => q.id === id)
      const pos = p ?? (id === this.myId && this.snap ? { x: this.local.x, y: this.local.y, alive: true } : null)
      if (!pos || !pos.alive) continue
      g.drawImage(this.emoteSprites[em.id]!, gx + Math.floor(pos.x * 16) + 2, gy + Math.floor(pos.y * 16) - 16)
    }
  }
}

function StoreFont(text: string): HTMLCanvasElement {
  return fontCanvas(text)
}

export const GAME = new GameScreen()
