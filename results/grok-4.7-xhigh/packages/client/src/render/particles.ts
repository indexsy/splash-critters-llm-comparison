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

export function burst(list: Particle[], x: number, y: number, color: string, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 8 + Math.random() * 28;
    list.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 8,
      life: 0.35 + Math.random() * 0.3,
      max: 0.55,
      color,
      size: 1 + (Math.random() > 0.7 ? 1 : 0),
    });
  }
}

export function updateParticles(list: Particle[], dt: number) {
  for (const p of list) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 30 * dt;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].life <= 0) list.splice(i, 1);
}

export function drawParticles(ctx: CanvasRenderingContext2D, list: Particle[]) {
  for (const p of list) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
