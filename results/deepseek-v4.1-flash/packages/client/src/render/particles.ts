interface Particle {
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
  private particles: Particle[] = [];

  clear(): void {
    this.particles.length = 0;
  }

  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    color: string,
    size: number,
    gravity: number,
  ): void {
    if (this.particles.length > 420) this.particles.shift();
    this.particles.push({ x, y, vx, vy, life, maxLife: life, color, size, gravity });
  }

  splash(x: number, y: number, color = "#bff6ff", count = 10): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 14 + Math.random() * 42;
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 16,
        0.35 + Math.random() * 0.4,
        i % 3 === 0 ? "#ffffff" : color,
        1 + (i % 2),
        110,
      );
    }
  }

  burst(x: number, y: number, splashColor = "#57c7ff"): void {
    this.splash(x, y, splashColor, 16);
    for (let i = 0; i < 5; i += 1) {
      this.spawn(x, y, (Math.random() - 0.5) * 20, -20 - Math.random() * 25, 0.5, "#2ec4b6", 2, 70);
    }
  }

  pickup(x: number, y: number, color = "#ffe066"): void {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      this.spawn(
        x,
        y,
        Math.cos(angle) * 28,
        Math.sin(angle) * 28,
        0.45,
        i % 2 === 0 ? "#ffffff" : color,
        1,
        0,
      );
    }
  }

  soak(x: number, y: number, dramatic = false): void {
    this.splash(x, y, "#57c7ff", dramatic ? 28 : 18);
    for (let i = 0; i < (dramatic ? 10 : 5); i += 1) {
      this.spawn(
        x + (Math.random() - 0.5) * 12,
        y + (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 18,
        -25 - Math.random() * 25,
        0.55,
        dramatic ? "#ff8fab" : "#9ee8ff",
        2,
        60,
      );
    }
  }

  confetti(x: number, y: number): void {
    const colors = ["#ffe066", "#ff6b6b", "#63d471", "#57c7ff", "#b28dff"];
    for (let i = 0; i < 30; i += 1) {
      this.spawn(
        x + (Math.random() - 0.5) * 90,
        y,
        (Math.random() - 0.5) * 35,
        -20 - Math.random() * 35,
        0.9 + Math.random() * 0.7,
        colors[i % colors.length]!,
        1 + (i % 2),
        50,
      );
    }
  }

  dust(x: number, y: number, color = "#d8b27b"): void {
    for (let i = 0; i < 7; i += 1) {
      this.spawn(
        x + (Math.random() - 0.5) * 12,
        y + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 20,
        -8 - Math.random() * 16,
        0.45,
        color,
        1 + (i % 2),
        55,
      );
    }
  }

  sparkle(x: number, y: number, color = "#7bf7e1"): void {
    this.spawn(x, y, (Math.random() - 0.5) * 8, -10, 0.4, color, 1, 0);
  }

  update(dt: number): void {
    const alive: Particle[] = [];
    for (const particle of this.particles) {
      particle.life -= dt;
      if (particle.life <= 0) continue;
      particle.vy += particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      alive.push(particle);
    }
    this.particles = alive;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      const alpha = Math.min(1, particle.life / Math.max(0.01, particle.maxLife * 0.5));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }
}
