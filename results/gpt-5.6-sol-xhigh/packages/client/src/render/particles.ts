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
  shape: "square" | "drop" | "star" | "ring";
  ringR?: number;
  ringMax?: number;
}

export class Particles {
  private list: Particle[] = [];
  private cap = 320;

  burst(x: number, y: number, count: number, color: string, opts: { speed?: number; life?: number; size?: number; gravity?: number; shape?: Particle["shape"]; spread?: number } = {}): void {
    const speed = opts.speed ?? 30;
    const life = opts.life ?? 0.6;
    const size = opts.size ?? 2;
    const gravity = opts.gravity ?? 60;
    const shape = opts.shape ?? "square";
    const spread = opts.spread ?? Math.PI * 2;
    const startAngle = -spread / 2 - (shape === "drop" ? Math.PI / 2 : 0);
    for (let i = 0; i < count; i++) {
      if (this.list.length >= this.cap) break;
      const a = startAngle + Math.random() * spread;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.list.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        maxLife: life,
        size: Math.max(1, Math.round(size * (0.6 + Math.random() * 0.8))),
        color,
        gravity,
        shape
      });
    }
  }

  splash(x: number, y: number, color = "#7ee4ff"): void {
    this.burst(x, y, 12, color, { speed: 60, life: 0.5, size: 2, gravity: 120, shape: "drop" });
    this.ring(x, y, color);
  }

  ring(x: number, y: number, color: string, max = 14): void {
    if (this.list.length >= this.cap) return;
    this.list.push({ x, y, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, size: 1, color, gravity: 0, shape: "ring", ringR: 0, ringMax: max });
  }

  pop(x: number, y: number, color: string): void {
    this.burst(x, y, 16, color, { speed: 80, life: 0.5, size: 2, gravity: 30, shape: "square" });
    this.ring(x, y, "#ffffff", 12);
  }

  sparkle(x: number, y: number, color = "#ffd83d"): void {
    this.burst(x, y, 6, color, { speed: 20, life: 0.6, size: 1, gravity: -10, shape: "star", spread: Math.PI * 2 });
  }

  dust(x: number, y: number, color = "#f3d68e"): void {
    this.burst(x, y, 4, color, { speed: 12, life: 0.3, size: 1, gravity: -20 });
  }

  update(dt: number): void {
    const next: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      if (p.shape === "ring" && p.ringR !== undefined && p.ringMax !== undefined) {
        p.ringR = p.ringMax * (1 - p.life / p.maxLife);
      }
      next.push(p);
    }
    this.list = next;
  }

  clear(): void { this.list = []; }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.shape === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0, p.ringR ?? 0), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === "drop") {
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size + 1);
      } else if (p.shape === "star") {
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        ctx.fillRect(Math.round(p.x - 1), Math.round(p.y + Math.floor(p.size / 2)), p.size + 2, 1);
        ctx.fillRect(Math.round(p.x + Math.floor(p.size / 2)), Math.round(p.y - 1), 1, p.size + 2);
      } else {
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.restore();
    }
  }

  get count(): number { return this.list.length; }
}
