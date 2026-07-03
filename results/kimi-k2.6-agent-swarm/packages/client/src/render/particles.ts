import { PALETTE } from './sprites.js';

export type ParticleType =
  | 'splash_droplets'
  | 'soak_sparkle'
  | 'castle_crumble'
  | 'powerup_glow'
  | 'tide_bubble';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: ParticleType;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private shakeFrames = 0;
  private shakeIntensity = 0;
  private reducedShake = false;
  private screenEffects = true;
  private offsetX = 0;
  private offsetY = 0;

  setReducedShake(v: boolean): void {
    this.reducedShake = v;
  }

  setScreenEffects(v: boolean): void {
    this.screenEffects = v;
  }

  triggerShake(intensity: number): void {
    if (!this.screenEffects) return;
    this.shakeFrames = this.reducedShake ? 5 : 10;
    this.shakeIntensity = this.reducedShake ? intensity * 0.5 : intensity;
  }

  emit(type: ParticleType, x: number, y: number, color?: string): void {
    if (!this.screenEffects) return;

    switch (type) {
      case 'splash_droplets':
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
          const speed = 1 + Math.random() * 2;
          this.particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            life: 0.5 + Math.random() * 0.5,
            maxLife: 0.5 + Math.random() * 0.5,
            size: 2,
            color: color || PALETTE.skyBlue,
            type,
          });
        }
        break;

      case 'soak_sparkle':
        for (let i = 0; i < 12; i++) {
          const angle = (Math.PI * 2 * i) / 12;
          const speed = 0.5 + Math.random() * 1.5;
          this.particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.6 + Math.random() * 0.4,
            maxLife: 0.6 + Math.random() * 0.4,
            size: 1 + Math.random() * 2,
            color: Math.random() > 0.5 ? PALETTE.white : PALETTE.skyBlue,
            type,
          });
        }
        break;

      case 'castle_crumble':
        for (let i = 0; i < 10; i++) {
          this.particles.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 2,
            vy: -Math.random() * 2,
            life: 0.8 + Math.random() * 0.4,
            maxLife: 0.8 + Math.random() * 0.4,
            size: 2 + Math.random() * 2,
            color: Math.random() > 0.5 ? PALETTE.sand : PALETTE.beige,
            type,
          });
        }
        break;

      case 'powerup_glow':
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6;
          this.particles.push({
            x,
            y,
            vx: Math.cos(angle) * 0.5,
            vy: Math.sin(angle) * 0.5 - 0.5,
            life: 0.5,
            maxLife: 0.5,
            size: 2,
            color: color || PALETTE.yellow,
            type,
          });
        }
        break;

      case 'tide_bubble':
        this.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -0.5 - Math.random() * 0.5,
          life: 2 + Math.random() * 2,
          maxLife: 2 + Math.random() * 2,
          size: 1 + Math.random() * 2,
          color: PALETTE.white,
          type,
        });
        break;
    }
  }

  update(dt: number): void {
    // Update particles
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // Update shake
    if (this.shakeFrames > 0) {
      this.shakeFrames--;
      this.offsetX = (Math.random() - 0.5) * this.shakeIntensity;
      this.offsetY = (Math.random() - 0.5) * this.shakeIntensity;
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  getShakeOffset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x - p.size / 2), Math.floor(p.y - p.size / 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
