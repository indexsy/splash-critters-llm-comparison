// particles.ts — simple particle system for splash droplets, soak effects, juice.
export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number;
}

export class Particles {
  list: Particle[] = [];

  burst(x: number, y: number, color: string, count = 8, speed = 1) {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random();
      this.list.push({
        x, y,
        vx: Math.cos(a) * speed * (0.5 + Math.random()),
        vy: Math.sin(a) * speed * (0.5 + Math.random()),
        life: 20 + Math.random() * 10,
        maxLife: 30,
        color,
        size: 1 + Math.floor(Math.random() * 2),
      });
    }
  }

  update() {
    for (const p of this.list) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.life--;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.list = [];
  }
}
