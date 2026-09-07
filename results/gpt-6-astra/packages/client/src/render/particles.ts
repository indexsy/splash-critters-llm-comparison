import type { Animal, GameEvent } from "@splash/shared";
import { drawAnimal } from "./sprites.js";
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}
export class Particles {
  private particles: Particle[] = [];
  private ghosts: { x: number; y: number; animal: Animal; age: number }[] = [];
  emit(event: GameEvent, animal: Animal = "frog"): void {
    if (
      !("x" in event) ||
      ![
        "balloon_burst",
        "castle_washed",
        "player_soaked",
        "powerup_collected",
      ].includes(event.type)
    )
      return;
    const color =
      event.type === "castle_washed"
        ? "#f4d79d"
        : event.type === "powerup_collected"
          ? "#fff2ad"
          : "#c9f8ed";
    const count =
      event.type === "player_soaked" ? (animal === "cat" ? 48 : 24) : 9;
    if (event.type === "player_soaked")
      this.ghosts.push({
        x: event.x * 16 - 8,
        y: event.y * 16 - 8,
        animal,
        age: 0,
      });
    for (let i = 0; i < count && this.particles.length < 300; i++)
      this.particles.push({
        x: event.x * 16 + (event.type === "player_soaked" ? 0 : 8),
        y: event.y * 16 + (event.type === "player_soaked" ? 0 : 8),
        vx: (Math.random() - 0.5) * 70,
        vy: -15 - Math.random() * 60,
        life: 0.4 + Math.random() * 0.35,
        color,
        size: i % 3 ? 1 : 2,
      });
  }
  draw(
    ctx: CanvasRenderingContext2D,
    dt: number,
    ox: number,
    oy: number,
  ): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      const duration = g.animal === "cat" ? 1.25 : 0.65;
      if (g.age > duration) {
        this.ghosts.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - g.age / duration);
      const jump =
        Math.sin(Math.min(1, g.age / duration) * Math.PI) *
        (g.animal === "cat" ? 22 : 9);
      drawAnimal(
        ctx,
        g.x + ox,
        g.y + oy - jump,
        g.animal,
        "none",
        Math.floor(g.age * 18) % 2,
        1,
        true,
      );
      if (g.animal === "cat") {
        ctx.fillStyle = "#fff9e9";
        ctx.fillRect(g.x + ox - 3, g.y + oy - jump - 8, 23, 7);
        ctx.fillStyle = "#253e3b";
        ctx.font = "6px monospace";
        ctx.fillText("NOPE!", g.x + ox - 1, g.y + oy - jump - 2);
      }
      ctx.restore();
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 100 * dt;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x + ox), Math.round(p.y + oy), p.size, p.size);
    }
  }
  reset(): void {
    this.particles.length = 0;
    this.ghosts.length = 0;
  }
}
