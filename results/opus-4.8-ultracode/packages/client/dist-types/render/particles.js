/**
 * Lightweight particle system (droplets, castle crumble bits, pickup sparkles).
 * Coordinates are in backbuffer pixels.
 */
import { circle, rect, withAlpha } from './pixel';
export class Particles {
    parts = [];
    add(p) {
        if (this.parts.length < 400)
            this.parts.push(p);
    }
    splash(x, y, color, count = 10) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 20 + Math.random() * 60;
            this.add({
                x,
                y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 20,
                life: 0.4 + Math.random() * 0.3,
                maxLife: 0.7,
                size: 1 + Math.random() * 1.5,
                color,
                gravity: 120,
                square: false,
            });
        }
    }
    crumble(x, y, color) {
        for (let i = 0; i < 8; i++) {
            this.add({
                x,
                y,
                vx: (Math.random() - 0.5) * 60,
                vy: -Math.random() * 60,
                life: 0.5,
                maxLife: 0.5,
                size: 1.5 + Math.random() * 1.5,
                color,
                gravity: 200,
                square: true,
            });
        }
    }
    sparkle(x, y, color) {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            this.add({
                x,
                y,
                vx: Math.cos(a) * 40,
                vy: Math.sin(a) * 40,
                life: 0.4,
                maxLife: 0.4,
                size: 1.5,
                color,
                gravity: 0,
                square: false,
            });
        }
    }
    update(dt) {
        for (const p of this.parts) {
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
        }
        this.parts = this.parts.filter((p) => p.life > 0);
    }
    draw(ctx) {
        for (const p of this.parts) {
            const a = Math.max(0, p.life / p.maxLife);
            withAlpha(ctx, a, () => {
                if (p.square)
                    rect(ctx, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, p.color);
                else
                    circle(ctx, p.x, p.y, p.size, p.color);
            });
        }
    }
    clear() {
        this.parts = [];
    }
}
//# sourceMappingURL=particles.js.map