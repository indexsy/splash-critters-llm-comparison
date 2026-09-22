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

export function burst(list: Particle[], x: number, y: number, color: string, n = 10): void {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const s = 0.4 + Math.random() * 1.2;
    list.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 0.4,
      life: 280 + Math.random() * 200,
      max: 480,
      color,
      size: 1 + (i % 2),
    });
  }
}

export function updateParticles(list: Particle[], dt: number): void {
  for (const p of list) {
    p.life -= dt;
    p.x += p.vx * dt * 0.05;
    p.y += p.vy * dt * 0.05;
    p.vy += 0.02;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.life <= 0) list.splice(i, 1);
}
