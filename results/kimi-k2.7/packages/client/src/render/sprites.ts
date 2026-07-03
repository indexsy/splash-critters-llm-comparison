import type { Balloon, Player, RoundState } from "@splash/shared";
import { CONFIG, isBoulder, themeBackground, themeBoulder, themeCastle } from "@splash/shared";
import { TILE_SIZE } from "@splash/shared";

export class Renderer {
  colors = {
    frog: ["#4ade80", "#166534"],
    duck: ["#facc15", "#ca8a04"],
    otter: ["#9ca3af", "#4b5563"],
    penguin: ["#1f2937", "#f3f4f6"],
    cat: ["#fb923c", "#c2410c"],
    raccoon: ["#a1a1aa", "#3f3f46"],
    turtle: ["#22c55e", "#15803d"],
    capybara: ["#a16207", "#713f12"],
  };

  drawRound(ctx: CanvasRenderingContext2D, state: RoundState, localId?: string) {
    const ox = 16;
    const oy = 32;
    const scale = TILE_SIZE;

    // Background
    ctx.fillStyle = themeBackground(state.theme);
    ctx.fillRect(ox, oy, state.width * scale, state.height * scale);

    // Tide
    if (state.tideRing >= 0) {
      for (let x = 0; x < state.width; x++) {
        for (let y = 0; y < state.height; y++) {
          const d = Math.min(x, y, state.width - 1 - x, state.height - 1 - y);
          if (d <= state.tideRing) {
            ctx.fillStyle = "rgba(56, 189, 248, 0.6)";
            ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
          }
        }
      }
    }

    // Castles & boulders
    for (let x = 0; x < state.width; x++) {
      for (let y = 0; y < state.height; y++) {
        const px = ox + x * scale;
        const py = oy + y * scale;
        if (isBoulder(state.width, state.height, x, y)) {
          ctx.fillStyle = themeBoulder(state.theme);
          ctx.fillRect(px + 1, py + 1, scale - 2, scale - 2);
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.fillRect(px + 4, py + 4, scale - 8, 3);
        } else if (state.castles[x][y]?.hasCastle) {
          ctx.fillStyle = themeCastle(state.theme);
          ctx.fillRect(px + 2, py + 2, scale - 4, scale - 4);
          ctx.fillStyle = "rgba(0,0,0,0.15)";
          ctx.fillRect(px + 4, py + 4, scale - 8, scale - 10);
        }
      }
    }

    // Powerups
    for (const pu of state.powerUps) {
      this.drawPowerUp(ctx, ox + pu.tx * scale + scale / 2, oy + pu.ty * scale + scale / 2, pu.type);
    }

    // Balloons
    for (const b of state.balloons) {
      this.drawBalloon(ctx, ox + b.tx * scale + scale / 2, oy + b.ty * scale + scale / 2, b);
    }

    // Splashes
    for (const s of state.splashes) {
      this.drawSplash(ctx, ox + s.tx * scale + scale / 2, oy + s.ty * scale + scale / 2);
    }

    // Players
    for (const p of state.players) {
      this.drawPlayer(ctx, ox + p.pos.x * scale, oy + p.pos.y * scale, p, p.id === localId);
    }
  }

  drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, p: Player, isLocal: boolean) {
    const size = 12;
    const colors = this.colors[p.animal] || this.colors.frog;
    ctx.fillStyle = p.alive ? colors[0] : "#94a3b8";
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.fillStyle = colors[1];
    ctx.fillRect(x - size / 2 + 2, y - size / 2 + 2, 3, 3);
    ctx.fillRect(x + size / 2 - 5, y - size / 2 + 2, 3, 3);
    // hat
    if (p.hat !== "none") {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(x - size / 2, y - size / 2 - 3, size, 3);
    }
    if (isLocal) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
    }
  }

  drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, b: Balloon) {
    const t = b.fuseTick / CONFIG.BALLOON_FUSE_TICKS;
    const r = 4 + Math.sin(Date.now() / 100) * 1;
    ctx.fillStyle = `hsl(${200 + t * 40}, 80%, 55%)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bae6fd";
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPowerUp(ctx: CanvasRenderingContext2D, x: number, y: number, type: string) {
    const map: Record<string, [string, string]> = {
      extraBalloon: ["#f87171", "+B"],
      bigSplash: ["#fbbf24", "+R"],
      flippers: ["#60a5fa", "+S"],
      rubberBoots: ["#a78bfa", "K"],
    };
    const [color, label] = map[type] || ["#fff", "?"];
    ctx.fillStyle = color;
    ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.fillStyle = "#000";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 3);
  }
}
