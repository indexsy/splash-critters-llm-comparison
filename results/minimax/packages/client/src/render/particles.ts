import { PALETTE } from './sprites.js';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  kind: 'drop' | 'spark' | 'text' | 'ripple';
  text?: string;
}

/** Tiny particle system used for splashes, pickups and the dramatic soak. */
export class Particles {
  private items: Particle[] = [];

  clear(): void {
    this.items.length = 0;
  }

  get count(): number {
    return this.items.length;
  }

  spawn(particle: Partial<Particle> & { x: number; y: number }): void {
    this.items.push({
      vx: 0,
      vy: 0,
      life: 30,
      maxLife: 30,
      size: 1,
      color: PALETTE.foam,
      gravity: 0,
      kind: 'drop',
      ...particle,
    });
  }

  burst(
    x: number,
    y: number,
    count: number,
    options: {
      color?: string;
      speed?: number;
      life?: number;
      gravity?: number;
      size?: number;
      kind?: Particle['kind'];
    } = {},
  ): void {
    const color = options.color ?? PALETTE.foam;
    const speed = options.speed ?? 1.4;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const magnitude = speed * (0.5 + Math.random() * 0.9);
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * magnitude,
        vy: Math.sin(angle) * magnitude - 0.4,
        life: options.life ?? 26,
        maxLife: options.life ?? 26,
        size: options.size ?? 1,
        color,
        gravity: options.gravity ?? 0.05,
        kind: options.kind ?? 'drop',
      });
    }
  }

  popText(x: number, y: number, text: string, color: string): void {
    this.spawn({
      x,
      y,
      vx: 0,
      vy: -0.55,
      life: 46,
      maxLife: 46,
      size: 1,
      color,
      gravity: 0.01,
      kind: 'text',
      text,
    });
  }

  update(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.life -= 1;
      if (p.life <= 0) this.items.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const alpha = Math.max(0, Math.min(1, p.life / Math.max(1, p.maxLife)));
      ctx.globalAlpha = alpha;
      if (p.kind === 'ripple') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'text' && p.text) {
        ctx.fillStyle = p.color;
        ctx.font = '8px monospace';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}
