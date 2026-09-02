// Droplet particles + screen shake + hit-stop + announcer pops.
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export const particles: Particle[] = [];
export let shakeMag = 0;
export let hitStop = 0;
let announceText = '';
let announceT = 0;

export function burstParticles(x: number, y: number, colorblind: boolean): void {
  const colors = colorblind ? ['#ff9f1c', '#ffbf69', '#ffffff'] : ['#4cc9f0', '#90e0ef', '#ffffff'];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 30 + Math.random() * 70;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 20,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      color: colors[i % colors.length],
      size: 2,
    });
  }
}

export function soakParticles(x: number, y: number): void {
  for (let i = 0; i < 20; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 40,
      vy: -30 - Math.random() * 50,
      life: 0.7,
      maxLife: 0.7,
      color: '#caf0f8',
      size: 2,
    });
  }
}

export function addShake(m: number, enabled: boolean): void {
  if (!enabled) return;
  shakeMag = Math.min(8, shakeMag + m);
}

export function addHitStop(ticks: number): void {
  hitStop = Math.max(hitStop, ticks);
}

export function announce(t: string): void {
  announceText = t;
  announceT = 1.6;
}

export function currentAnnounce(): string {
  return announceT > 0 ? announceText : '';
}

export function updateFx(dt: number): { ox: number; oy: number } {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (hitStop > 0) hitStop -= dt * 30;
  announceT -= dt;
  const ox = shakeMag > 0.2 ? (Math.random() - 0.5) * shakeMag : 0;
  const oy = shakeMag > 0.2 ? (Math.random() - 0.5) * shakeMag : 0;
  shakeMag *= 0.88;
  return { ox, oy };
}

export function drawParticles(g: CanvasRenderingContext2D): void {
  for (const p of particles) {
    g.globalAlpha = Math.max(0, p.life / p.maxLife);
    g.fillStyle = p.color;
    g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  g.globalAlpha = 1;
}
