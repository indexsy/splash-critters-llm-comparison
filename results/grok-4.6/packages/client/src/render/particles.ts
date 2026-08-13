export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export const particles: Particle[] = [];

export function burst(x: number, y: number, color: string, n = 8): void {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const sp = 0.4 + Math.random() * 1.2;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 18 + Math.random() * 10,
      max: 28,
      color,
      size: 1 + Math.random() * 2,
    });
  }
}

export function tickParticles(): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.04;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, ox: number, oy: number, tile: number): void {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(ox + p.x * tile, oy + p.y * tile, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
