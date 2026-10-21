import type { C2S, S2C, PlayerProfile } from '@splash/shared'

export interface NetHooks {
  onMsg(msg: S2C): void
  onDown(): void
  onUp(): void
}

const LAG = (() => {
  const p = new URLSearchParams(location.search)
  const v = Number(p.get('lag') ?? 0)
  return Number.isFinite(v) && v > 0 ? v : 0
})()

export const NetState = { down: false }

export class Net {
  ws: WebSocket | null = null
  profile: PlayerProfile | null = null
  token: string = localStorage.getItem('sc_token') ?? ''
  ready = false
  private hooks: NetHooks
  private queue: C2S[] = []

  constructor(hooks: NetHooks) {
    this.hooks = hooks
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.ready = true
      NetState.down = false
      this.hooks.onUp()
      this.send({ t: 'hello', token: this.token })
      for (const m of this.queue) this.send(m)
      this.queue.length = 0
    }
    ws.onmessage = (ev) => {
      let msg: S2C
      try {
        msg = JSON.parse(String(ev.data)) as S2C
      } catch {
        return
      }
      if (LAG > 0) {
        setTimeout(() => this.handle(msg), LAG / 2)
      } else {
        this.handle(msg)
      }
    }
    ws.onclose = () => {
      this.ready = false
      NetState.down = true
      this.hooks.onDown()
      setTimeout(() => this.connect(), 900)
    }
  }

  private handle(msg: S2C): void {
    if (msg.t === 'welcome') {
      this.token = msg.token
      localStorage.setItem('sc_token', msg.token)
      this.profile = msg.profile
    }
    this.hooks.onMsg(msg)
  }

  send(msg: C2S): void {
    if (!this.ws || this.ws.readyState !== 1) {
      this.queue.push(msg)
      this.queue = this.queue.slice(-30)
      return
    }
    const doit = () => {
      try {
        this.ws?.send(JSON.stringify(msg))
      } catch {
        /* ignore */
      }
    }
    if (LAG > 0) setTimeout(doit, LAG / 2)
    else doit()
  }

  get lag(): number {
    return LAG
  }
}
