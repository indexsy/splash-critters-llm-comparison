// Pixel particles in arena coordinates: splash droplets that arc and land, sand crumbs from
// washed castles, and twinkling sparkles for pickups and reveals. Visual only (Math.random).

type Kind = 'drop' | 'crumb' | 'spark';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  /** Height above the ground (pixels); drawn at y - z. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const GRAVITY = 260; // px / s^2 on z
const MAX_PARTICLES = 600;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export class Particles {
  private list: Particle[] = [];

  get count(): number {
    return this.list.length;
  }

  private add(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  /** Droplets thrown up from a point, fanning out `spread` px/s. */
  droplets(x: number, y: number, count: number, colors: readonly string[], spread = 40): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(spread * 0.3, spread);
      const life = rand(0.35, 0.7);
      this.add({ kind: 'drop', x: x + rand(-3, 3), y: y + rand(-3, 3), z: rand(2, 6), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: rand(40, 110), life, maxLife: life, color: pick(colors), size: Math.random() < 0.3 ? 2 : 1 });
    }
  }

  /** Spray along a splash arm tile: droplets drift in the arm's direction. */
  spray(x: number, y: number, dx: number, dy: number, count: number, colors: readonly string[]): void {
    for (let i = 0; i < count; i++) {
      const life = rand(0.25, 0.5);
      this.add({ kind: 'drop', x: x + rand(-6, 6), y: y + rand(-6, 6), z: rand(1, 5), vx: dx * rand(10, 50) + rand(-12, 12), vy: dy * rand(10, 50) + rand(-12, 12), vz: rand(20, 70), life, maxLife: life, color: pick(colors), size: 1 });
    }
  }

  /** Sand crumbs tumbling out of a washed castle. */
  crumbs(x: number, y: number, colors: readonly string[]): void {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(10, 34);
      const life = rand(0.3, 0.6);
      this.add({ kind: 'crumb', x: x + rand(-5, 5), y: y + rand(-4, 4), z: rand(3, 9), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: rand(30, 80), life, maxLife: life, color: pick(colors), size: Math.random() < 0.4 ? 2 : 1 });
    }
  }

  /** Twinkling sparkles rising from a pickup or reveal. */
  sparkles(x: number, y: number, colors: readonly string[], count = 6): void {
    for (let i = 0; i < count; i++) {
      const life = rand(0.4, 0.8);
      this.add({ kind: 'spark', x: x + rand(-7, 7), y: y + rand(-6, 4), z: rand(0, 6), vx: rand(-6, 6), vy: 0, vz: rand(12, 30), life, maxLife: life, color: pick(colors), size: 1 });
    }
  }

  update(dtSec: number): void {
    const dt = Math.min(0.05, Math.max(0, dtSec));
    const kept: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'spark') {
        p.z += p.vz * dt;
      } else {
        p.vz -= GRAVITY * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) continue; // landed
      }
      kept.push(p);
    }
    this.list = kept;
  }

  /** Draw every particle with the arena origin at (ox, oy). */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (const p of this.list) {
      const x = Math.round(ox + p.x);
      const y = Math.round(oy + p.y - p.z);
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        const big = p.life > p.maxLife * 0.4 && Math.floor(p.life * 20) % 2 === 0;
        ctx.fillRect(x, y, 1, 1);
        if (big) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      } else {
        ctx.fillRect(x, y, p.size, p.size);
      }
    }
  }

  clear(): void {
    this.list = [];
  }
}
