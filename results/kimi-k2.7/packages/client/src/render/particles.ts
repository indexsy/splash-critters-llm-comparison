export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

export class ParticleSystem {
  particles: Particle[] = [];

  emit(x: number, y: number, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        life: 1.0,
        color,
      });
    }
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt * 2;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(ox + p.x, oy + p.y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}
