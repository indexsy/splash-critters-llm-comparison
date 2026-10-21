export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export class Particles {
  private pool: Particle[] = []

  spawnSplash(tx: number, ty: number, ox: number, oy: number, powers = 1): void {
    const n = 10 * powers
    for (let i = 0; i < n; i++) {
      if (this.pool.length > 220) break
      const ang = Math.random() * Math.PI * 2
      const sp = (0.5 + Math.random() * 1.1) * powers
      this.pool.push({
        x: ox + tx * 16 + 8,
        y: oy + ty * 16 + 8,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 1.6,
        life: 1,
        maxLife: 0.5 + Math.random() * 0.4,
        color: Math.random() < 0.4 ? '#e8f7ff' : '#7ec9ff',
        size: Math.random() < 0.5 ? 1 : 2
      })
    }
  }

  spawnCrumble(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      if (this.pool.length > 220) break
      this.pool.push({
        x: x + 4 + Math.random() * 8,
        y: y + 4 + Math.random() * 8,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -0.8 - Math.random(),
        life: 1,
        maxLife: 0.6 + Math.random() * 0.3,
        color: Math.random() < 0.5 ? '#d9b36c' : '#b98f4e',
        size: 2
      })
    }
  }

  spawnConfetti(x: number, y: number): void {
    const colors = ['#e94f37', '#ffd23f', '#3ecf6e', '#3aa0ff', '#b96bff']
    for (let i = 0; i < 24; i++) {
      this.pool.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 3,
        vy: -1 - Math.random() * 2,
        life: 1,
        maxLife: 1 + Math.random(),
        color: colors[(Math.random() * colors.length) | 0]!,
        size: 2
      })
    }
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i]!
      p.vy += 4.2 * dt
      p.x += p.vx * dt * 26
      p.y += p.vy * dt * 26
      p.life -= dt / p.maxLife
      if (p.life <= 0) this.pool.splice(i, 1)
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life))
      g.fillStyle = p.color
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size)
    }
    g.globalAlpha = 1
  }

  clear(): void {
    this.pool.length = 0
  }
}
