import { fontCanvas, tintCanvas } from './sprites'
import type { Snapshot } from '@splash/shared'
import { Store } from '../main'

export interface Announce {
  text: string
  life: number
  big: boolean
}

export class Feed {
  rows: Array<{ text: string; life: number }> = []
  announces: Announce[] = []

  push(text: string): void {
    this.rows.unshift({ text: text.slice(0, 32), life: 5 })
    if (this.rows.length > 4) this.rows.length = 4
  }

  announce(text: string, big = false): void {
    this.announces.push({ text: text.slice(0, 20), life: big ? 2.2 : 1.6, big })
    if (this.announces.length > 2) this.announces.shift()
  }

  engageNone(): void {
    void this
  }

  update(dt: number): void {
    for (const r of this.rows) r.life -= dt
    this.rows = this.rows.filter((r) => r.life > 0)
    for (const a of this.announces) a.life -= dt
    this.announces = this.announces.filter((a) => a.life > 0)
  }

  draw(g: CanvasRenderingContext2D): void {
    this.rows.forEach((r, i) => {
      const img = fontCanvas(r.text.slice(0, 26).toUpperCase())
      g.globalAlpha = Math.min(1, r.life)
      g.fillStyle = 'rgba(8,10,25,0.65)'
      g.fillRect(4, 34 + i * 9, img.width + 4, 8)
      g.drawImage(tintCanvas(img, '#f8f8f8'), 6, 36 + i * 9)
      g.globalAlpha = 1
    })
    this.announces.forEach((a, i) => {
      const img = fontCanvas(a.text.toUpperCase())
      const scale = a.big ? 2 : 1
      const w = img.width * scale
      const x = Math.round((256 - w) / 2)
      const y = 62 + i * (a.big ? 24 : 16)
      g.globalAlpha = Math.min(1, a.life * 2)
      g.fillStyle = 'rgba(8,10,25,0.75)'
      g.fillRect(x - 4, y - 4, w + 8, img.height * scale + 8)
      g.imageSmoothingEnabled = false
      g.drawImage(tintCanvas(img, a.big ? '#ffd23f' : '#e8f7ff'), 0, 0, img.width, img.height, x, y, w, img.height * scale)
      g.globalAlpha = 1
    })
  }
}

export function drawHudStrip(g: CanvasRenderingContext2D, snap: Snapshot | null, myId: number, roundWins: Record<number, number>): void {
  const barY = 34
  g.fillStyle = 'rgba(10,14,40,0.55)'
  g.fillRect(2, 2, 252, 12)
  if (!snap) return
  let x = 6
  for (const p of snap.players) {
    const me = p.id === myId
    const wins = roundWins[p.id] ?? 0
    const frames = Store.animals[p.animal] ?? Store.animals['frog']!
    const img = p.alive ? frames.a : frames.soak
    if (Number.isFinite(p.id) && p.id >= 0 && img) g.drawImage(img, 0, 0, 16, 16, x, barY - 6, 12, 12)
    const txt = `${p.nickname}${wins ? ` ${'*'.repeat(Math.min(4, wins))}` : ''}`.toUpperCase().slice(0, 9)
    const f = fontCanvas(txt)
    g.drawImage(tintCanvas(f, me ? '#ffd23f' : p.alive ? '#ffffff' : '#8a93a8'), x + 13, barY - 5)
    x += 15 + f.width
    if (x > 250) break
  }
}
