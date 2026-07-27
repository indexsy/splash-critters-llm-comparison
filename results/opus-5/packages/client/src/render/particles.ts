/**
 * The particle pool.
 *
 * Fixed capacity, parallel typed arrays, no allocation once constructed: a big
 * chain burst can ask for a hundred particles in a single frame and the only
 * cost is arithmetic. Positions and velocities are in TILE units so a burst can
 * be requested straight from a sim event without knowing the layout, and the
 * layout is applied at draw time.
 */

import { splashColors } from './palette';
import type { ArenaLayout } from './palette';

export type ParticleKind = 'splash' | 'castle' | 'pickup' | 'soak' | 'kick';

const CAPACITY = 240;

interface KindSpec {
  count: number;
  /** Tiles per second. */
  speedMin: number;
  speedMax: number;
  /** Tiles per second squared. */
  gravity: number;
  lifeMin: number;
  lifeMax: number;
  /** Even spacing around a circle instead of random angles. */
  ring: boolean;
  /** Upward bias applied to the initial velocity, in tiles per second. */
  lift: number;
  bigChance: number;
  palette: string[] | null;
}

const KINDS: Record<ParticleKind, KindSpec> = {
  splash: {
    count: 10, speedMin: 1.6, speedMax: 4.4, gravity: 16, lifeMin: 240, lifeMax: 480,
    ring: false, lift: 2.2, bigChance: 0.35, palette: null,
  },
  castle: {
    count: 9, speedMin: 1.2, speedMax: 3.6, gravity: 22, lifeMin: 300, lifeMax: 620,
    ring: false, lift: 2.6, bigChance: 0.25, palette: ['#e6c48a', '#c49a5f', '#f0dfae'],
  },
  pickup: {
    count: 8, speedMin: 2.2, speedMax: 2.6, gravity: 0, lifeMin: 220, lifeMax: 320,
    ring: true, lift: 0, bigChance: 0, palette: ['#ffd24a', '#ffffff'],
  },
  soak: {
    count: 20, speedMin: 2.2, speedMax: 6.5, gravity: 14, lifeMin: 380, lifeMax: 760,
    ring: false, lift: 3.2, bigChance: 0.5, palette: null,
  },
  kick: {
    count: 5, speedMin: 0.8, speedMax: 2.2, gravity: 4, lifeMin: 150, lifeMax: 260,
    ring: false, lift: 0.4, bigChance: 0, palette: ['#d8dbe3', '#8f9bc4'],
  },
};

export class ParticleField {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
  private readonly gravity = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly size = new Uint8Array(CAPACITY);
  private readonly alive = new Uint8Array(CAPACITY);
  private readonly color: string[] = new Array<string>(CAPACITY).fill('#ffffff');
  private cursor = 0;
  private liveCount = 0;

  /** x and y are TILE coordinates. `color` overrides the kind's own palette. */
  burst(x: number, y: number, kind: ParticleKind, color?: string): void {
    const spec = KINDS[kind];
    const palette = color ? [color] : (spec.palette ?? splashColors());
    for (let i = 0; i < spec.count; i++) {
      const angle = spec.ring
        ? (i / spec.count) * Math.PI * 2
        : Math.random() * Math.PI * 2;
      const speed = spec.speedMin + Math.random() * (spec.speedMax - spec.speedMin);
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - spec.lift,
        spec.gravity,
        spec.lifeMin + Math.random() * (spec.lifeMax - spec.lifeMin),
        Math.random() < spec.bigChance ? 2 : 1,
        palette[i % palette.length],
      );
    }
  }

  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    gravity: number,
    life: number,
    size: number,
    color: string,
  ): void {
    const slot = this.freeSlot();
    if (this.alive[slot] === 0) this.liveCount++;
    this.alive[slot] = 1;
    this.x[slot] = x;
    this.y[slot] = y;
    this.vx[slot] = vx;
    this.vy[slot] = vy;
    this.gravity[slot] = gravity;
    this.life[slot] = life;
    this.maxLife[slot] = life;
    this.size[slot] = size;
    this.color[slot] = color;
  }

  /** First dead slot from the rolling cursor; a full pool recycles the oldest. */
  private freeSlot(): number {
    for (let step = 0; step < CAPACITY; step++) {
      const slot = (this.cursor + step) % CAPACITY;
      if (this.alive[slot] === 0) {
        this.cursor = (slot + 1) % CAPACITY;
        return slot;
      }
    }
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    return slot;
  }

  update(dtMs: number): void {
    if (this.liveCount === 0) return;
    const dt = dtMs / 1000;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.alive[i] === 0) continue;
      this.life[i] -= dtMs;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.liveCount--;
        continue;
      }
      this.vy[i] += this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, layout: ArenaLayout): void {
    if (this.liveCount === 0) return;
    const previousAlpha = ctx.globalAlpha;
    let currentAlpha = -1;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.alive[i] === 0) continue;
      const remaining = this.life[i] / this.maxLife[i];
      // Three discrete alpha steps, because a smooth ramp reads as mush at 1px.
      const alpha = remaining > 0.6 ? 1 : remaining > 0.3 ? 0.7 : 0.4;
      if (alpha !== currentAlpha) {
        ctx.globalAlpha = alpha;
        currentAlpha = alpha;
      }
      ctx.fillStyle = this.color[i];
      ctx.fillRect(
        Math.round(layout.originX + this.x[i] * layout.tile),
        Math.round(layout.originY + this.y[i] * layout.tile),
        this.size[i],
        this.size[i],
      );
    }
    ctx.globalAlpha = previousAlpha;
  }

  clear(): void {
    this.alive.fill(0);
    this.liveCount = 0;
    this.cursor = 0;
  }

  get count(): number {
    return this.liveCount;
  }
}
