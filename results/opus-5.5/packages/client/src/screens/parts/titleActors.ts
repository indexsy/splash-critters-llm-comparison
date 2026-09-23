// Title-screen actors: critters strolling on the beach, water balloons lobbed in arcs that pop
// into cross splashes with droplet spray. Pure canvas drawing driven by a millisecond clock.
import { CONFIG, Dir, type AnimalId, type HatId } from '@splash/shared';
import { splashPalette } from '../../render/palette';
import { hashInts } from '../../render/pixelart';
import {
  BALLOON_FRAMES,
  CRITTER_OY,
  animalFrameAt,
  getBalloon,
  getCritter,
  getShadow,
  getSplash,
  splashFrameAt,
} from '../../render/sprites';

const TILE = 16;
const SPLASH_MS = (CONFIG.SPLASH_TICKS * 1000) / CONFIG.TICK_RATE;
const FLIGHT_MS = 750;
const DROPLET_MS = 520;
const THROW_EVERY_MS = 1100;

interface Walker {
  animal: AnimalId;
  hat: HatId;
  slot: number;
  x: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
}

interface Throw {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  slot: number;
  start: number;
}

interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  start: number;
}

export interface Beach {
  /** Walkable band (feet y) on the canvas. */
  top: number;
  bottom: number;
  width: number;
}

export class TitleActors {
  private walkers: Walker[];
  private throws: Throw[] = [];
  private splashes: { x: number; y: number; start: number }[] = [];
  private droplets: Droplet[] = [];
  private lastThrow = 0;
  private seq = 0;
  private lastT = 0;

  constructor(private readonly beach: Beach) {
    const lane = (i: number) => beach.top + Math.round(((beach.bottom - beach.top) * i) / 3);
    this.walkers = [
      { animal: 'frog', hat: 'bucket', slot: 0, x: 30, y: lane(1), dir: 1, speed: 20, phase: 0 },
      { animal: 'duck', hat: 'none', slot: 1, x: 200, y: lane(0), dir: -1, speed: 16, phase: 50 },
      { animal: 'capybara', hat: 'propeller', slot: 2, x: 120, y: lane(3), dir: 1, speed: 12, phase: 90 },
      { animal: 'cat', hat: 'crown', slot: 3, x: 90, y: lane(2), dir: -1, speed: 24, phase: 30 },
    ];
  }

  update(t: number): void {
    const dt = Math.min(100, t - (this.lastT || t)) / 1000;
    this.lastT = t;
    for (const w of this.walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x < 6) w.dir = 1;
      else if (w.x > this.beach.width - 22) w.dir = -1;
    }
    if (t - this.lastThrow > THROW_EVERY_MS) {
      this.lastThrow = t;
      this.launch(t);
    }
    this.land(t);
    this.splashes = this.splashes.filter((s) => t - s.start < SPLASH_MS);
    this.droplets = this.droplets.filter((d) => t - d.start < DROPLET_MS);
  }

  draw(ctx: CanvasRenderingContext2D, t: number, colorblind: boolean): void {
    for (const s of this.splashes) this.drawSplash(ctx, s.x, s.y, t - s.start, colorblind);
    const byDepth = [...this.walkers].sort((a, b) => a.y - b.y);
    for (const w of byDepth) this.drawWalker(ctx, w, t, colorblind);
    for (const th of this.throws) this.drawThrow(ctx, th, t, colorblind);
    this.drawDroplets(ctx, t);
  }

  private launch(t: number): void {
    this.seq += 1;
    const thrower = this.walkers[this.seq % this.walkers.length];
    const r = hashInts(this.seq, 41);
    const toX = TILE + (r % (this.beach.width - 3 * TILE));
    const toY = this.beach.top + ((r >>> 8) % Math.max(1, this.beach.bottom - this.beach.top));
    this.throws.push({ fromX: thrower.x + 8, fromY: thrower.y - 10, toX, toY, slot: thrower.slot, start: t });
  }

  private land(t: number): void {
    const landed = this.throws.filter((th) => t - th.start >= FLIGHT_MS);
    if (landed.length === 0) return;
    this.throws = this.throws.filter((th) => t - th.start < FLIGHT_MS);
    for (const th of landed) {
      this.splashes.push({ x: th.toX, y: th.toY, start: t });
      this.spray(th.toX, th.toY, t);
    }
  }

  private spray(x: number, y: number, t: number): void {
    const colors = splashPalette(false).droplets;
    for (let i = 0; i < 12; i++) {
      const r = hashInts(this.seq, i, 97);
      const angle = (r % 628) / 100;
      const speed = 30 + ((r >>> 10) % 40);
      this.droplets.push({
        x,
        y: y - 4,
        vx: Math.cos(angle) * speed,
        vy: -Math.abs(Math.sin(angle) * speed) - 20,
        color: colors[(r >>> 4) % colors.length],
        start: t,
      });
    }
  }

  private drawWalker(ctx: CanvasRenderingContext2D, w: Walker, t: number, colorblind: boolean): void {
    const frame = animalFrameAt(true, t + w.phase);
    const dir = w.dir > 0 ? Dir.Right : Dir.Left;
    const hatFrame = Math.floor((t + w.phase) / 80);
    const sprite = getCritter(w.animal, w.hat, dir, frame, w.slot, colorblind, hatFrame);
    const x = Math.round(w.x);
    ctx.drawImage(getShadow(12), x + 2, w.y - 3);
    ctx.drawImage(sprite, x, w.y - 16 - CRITTER_OY);
  }

  private drawThrow(ctx: CanvasRenderingContext2D, th: Throw, t: number, colorblind: boolean): void {
    const p = Math.min(1, (t - th.start) / FLIGHT_MS);
    const x = th.fromX + (th.toX - th.fromX) * p;
    const arc = Math.sin(p * Math.PI) * 44;
    const y = th.fromY + (th.toY - th.fromY) * p - arc;
    const frame = Math.min(BALLOON_FRAMES - 1, Math.floor(p * BALLOON_FRAMES));
    ctx.drawImage(getShadow(8), Math.round(th.toX - 4 + (x - th.toX) * 0.3), th.toY - 2);
    ctx.drawImage(getBalloon(frame, th.slot, colorblind, false), Math.round(x - 8), Math.round(y - 14));
  }

  private drawSplash(ctx: CanvasRenderingContext2D, cx: number, cy: number, elapsedMs: number, colorblind: boolean): void {
    const frame = splashFrameAt(elapsedMs / (1000 / CONFIG.TICK_RATE), CONFIG.SPLASH_TICKS);
    const x = Math.round(cx - TILE / 2);
    const y = Math.round(cy - TILE + 2);
    ctx.drawImage(getSplash('center', Dir.None, frame, colorblind), x, y);
    ctx.drawImage(getSplash('end', Dir.Up, frame, colorblind), x, y - TILE);
    ctx.drawImage(getSplash('end', Dir.Down, frame, colorblind), x, y + TILE);
    ctx.drawImage(getSplash('end', Dir.Left, frame, colorblind), x - TILE, y);
    ctx.drawImage(getSplash('end', Dir.Right, frame, colorblind), x + TILE, y);
  }

  private drawDroplets(ctx: CanvasRenderingContext2D, t: number): void {
    for (const d of this.droplets) {
      const s = (t - d.start) / 1000;
      const x = Math.round(d.x + d.vx * s);
      const y = Math.round(d.y + d.vy * s + 140 * s * s);
      ctx.fillStyle = d.color;
      ctx.fillRect(x, y, 1, 1);
      if ((t - d.start) < DROPLET_MS / 2) ctx.fillRect(x, y - 1, 1, 1);
    }
  }
}
