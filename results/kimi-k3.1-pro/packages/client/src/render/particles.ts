interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

export class ParticleSystem {
  private readonly particles: Particle[];
  private cursor = 0;

  constructor(count = 240) {
    this.particles = Array.from({ length: count }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: "#fff", size: 1, gravity: 0 }));
  }

  private spawn(x: number, y: number, color: string, speed: number, life: number, size: number, gravity: number): void {
    const particle = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;
    const angle = Math.random() * Math.PI * 2;
    const velocity = Math.random() * speed;
    particle.active = true;
    particle.x = x;
    particle.y = y;
    particle.vx = Math.cos(angle) * velocity;
    particle.vy = Math.sin(angle) * velocity - speed * 0.25;
    particle.life = life;
    particle.maxLife = life;
    particle.color = color;
    particle.size = size;
    particle.gravity = gravity;
  }

  splash(x: number, y: number, colorblind: boolean): void {
    const color = colorblind ? "#f9dc5c" : "#8be9fd";
    for (let index = 0; index < 10; index += 1) this.spawn(x, y, index % 3 ? color : "#f7f3d5", 45, 0.45, index % 2 ? 1 : 2, 80);
  }

  castle(x: number, y: number): void {
    for (let index = 0; index < 12; index += 1) this.spawn(x, y, index % 2 ? "#e7bd68" : "#a8743c", 30, 0.55, 2, 70);
  }

  soak(x: number, y: number): void {
    for (let index = 0; index < 22; index += 1) this.spawn(x, y, index % 4 ? "#38bdf8" : "#f9dc5c", 55, 0.8, 2, 60);
  }

  pickup(x: number, y: number): void {
    for (let index = 0; index < 12; index += 1) this.spawn(x, y, index % 2 ? "#f9dc5c" : "#56e39f", 32, 0.6, 1, 25);
  }

  confetti(): void {
    for (let index = 0; index < 70; index += 1) this.spawn(128 + (Math.random() - 0.5) * 150, 30, ["#f9dc5c", "#8be9fd", "#56e39f", "#f78c4b"][index % 4], 45, 1.8, 2, 35);
  }

  update(delta: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.vy += particle.gravity * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      ctx.globalAlpha = Math.min(1, particle.life / Math.min(0.2, particle.maxLife));
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }
}
