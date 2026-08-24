export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export class Particles {
  private list: Particle[] = [];

  burst(x: number, y: number, n: number, colors: string[], power = 40): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = power * (0.4 + Math.random() * 0.8);
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        size: 1 + Math.random() * 2,
      });
    }
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 90 * dt;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * scale - p.size, p.y * scale - p.size, p.size * 2, p.size * 2);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.list = [];
  }
}
