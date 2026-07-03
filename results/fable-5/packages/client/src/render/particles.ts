import { PAL } from "./palette.js";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

export class Particles {
  private list: Particle[] = [];

  spawn(x: number, y: number, opts: Partial<Particle> & { color: string }): void {
    if (this.list.length > 400) this.list.shift();
    this.list.push({
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      life: opts.life ?? 0.5,
      maxLife: opts.life ?? 0.5,
      color: opts.color,
      size: opts.size ?? 1,
      gravity: opts.gravity ?? 0,
    });
  }

  burst(x: number, y: number, count: number, color: string, speed = 40, life = 0.5, gravity = 60): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.4,
        life: life * (0.6 + Math.random() * 0.8),
        color,
        size: Math.random() < 0.3 ? 2 : 1,
        gravity,
      });
    }
  }

  splashSpray(x: number, y: number, colorblind: boolean): void {
    const c = colorblind ? PAL.splashAlt : PAL.splash;
    this.burst(x, y, 6, c, 35, 0.4, 80);
    this.burst(x, y, 3, PAL.waterLight, 25, 0.35, 80);
  }

  castleCrumble(x: number, y: number): void {
    this.burst(x, y, 8, PAL.sand, 30, 0.5, 120);
    this.burst(x, y, 4, PAL.sandDark, 22, 0.45, 120);
  }

  soakSplash(x: number, y: number, dramatic: boolean): void {
    this.burst(x, y, dramatic ? 26 : 14, PAL.water, dramatic ? 70 : 45, 0.7, 90);
    this.burst(x, y, dramatic ? 12 : 6, PAL.waterLight, dramatic ? 55 : 35, 0.6, 90);
  }

  confetti(x: number, y: number): void {
    for (const c of [PAL.gold, PAL.green, PAL.waterLight, PAL.pink]) this.burst(x, y, 5, c, 55, 1.1, 50);
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  clear(): void {
    this.list = [];
  }
}
