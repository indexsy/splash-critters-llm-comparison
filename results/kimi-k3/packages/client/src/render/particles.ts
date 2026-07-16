export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

export class ParticleSystem {
  particles: Particle[] = [];

  burst(x: number, y: number, colors: string[], count = 12, speed = 1.6): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 0.5,
        life: 0,
        maxLife: 20 + Math.random() * 20,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        size: Math.random() < 0.3 ? 2 : 1,
        gravity: 0.04,
      });
    }
  }

  crumble(x: number, y: number, colors: string[]): void {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -Math.random() * 1.2,
        life: 0,
        maxLife: 25 + Math.random() * 15,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        size: 1 + (Math.random() < 0.4 ? 1 : 0),
        gravity: 0.08,
      });
    }
  }

  update(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      if (p.life >= p.maxLife) this.particles.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
