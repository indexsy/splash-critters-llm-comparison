/**
 * Draws the arena board and all live entities from a RenderView into the
 * 256x224 backbuffer. Pure drawing — no state.
 */

import { CONFIG, Tile, idx, type MapTheme } from '@splash/shared';
import type { RenderView } from '../prediction';
import { EMOTE_TEXT } from '../theme';
import type { Particles } from './particles';
import { rrect, text, VH, VW, withAlpha } from './pixel';
import {
  drawBalloon,
  drawBoulder,
  drawCritter,
  drawDuck,
  drawFlood,
  drawFloor,
  drawLob,
  drawPowerup,
  drawSandcastle,
  drawSplashCell,
} from './sprites';

export interface Board {
  tile: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

export function computeBoard(width: number, height: number, topHud: number): Board {
  const availH = VH - topHud;
  const tile = Math.max(6, Math.floor(Math.min(VW / width, availH / height)));
  const ox = Math.floor((VW - tile * width) / 2);
  const oy = topHud + Math.floor((availH - tile * height) / 2);
  return { tile, ox, oy, width, height };
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  view: RenderView,
  grid: number[],
  board: Board,
  theme: MapTheme,
  particles: Particles,
  opts: { colorblind: boolean; nowMs: number },
): void {
  const { tile, ox, oy, width, height } = board;
  const t = opts.nowMs / 1000;

  // tiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = ox + x * tile;
      const py = oy + y * tile;
      const cell = grid[idx(x, y, width)];
      if (cell === Tile.Flooded) drawFlood(ctx, px, py, tile, theme, t);
      else {
        drawFloor(ctx, px, py, tile, theme);
        if (cell === Tile.Boulder) drawBoulder(ctx, px, py, tile, theme);
        else if (cell === Tile.Sandcastle) drawSandcastle(ctx, px, py, tile, theme, 0);
      }
    }
  }

  const cx = (gx: number) => ox + (gx + 0.5) * tile;
  const cy = (gy: number) => oy + (gy + 0.5) * tile;

  // power-ups
  for (const p of view.powerups) drawPowerup(ctx, cx(p.x), cy(p.y), tile, p.type, t + p.x * 0.3);

  // splashes (under balloons/players)
  for (const s of view.splashes) {
    const life = Math.max(0, Math.min(1, (s.expiresTick - view.serverTick) / CONFIG.SPLASH_LINGER_TICKS));
    drawSplashCell(ctx, cx(s.x), cy(s.y), tile, s.ownerSlot, life, s.center, opts.colorblind);
  }

  // balloons
  for (const b of view.balloons) {
    const wob = (opts.nowMs / 500 + b.x * 0.3 + b.y * 0.2) % 1;
    if (b.ghost) {
      withAlpha(ctx, 0.55, () => drawBalloon(ctx, cx(b.x), cy(b.y), tile, b.ownerSlot, wob, b.fuseFrac, opts.colorblind));
    } else {
      drawBalloon(ctx, cx(b.x), cy(b.y), tile, b.ownerSlot, wob, b.fuseFrac, opts.colorblind);
    }
  }

  // revenge lobs
  for (const l of view.lobs) drawLob(ctx, cx(l.x), cy(l.y), tile, -1, opts.colorblind);

  // players (sorted by y so lower ones overlap correctly)
  const players = view.players.slice().sort((a, b) => a.y - b.y);
  for (const p of players) {
    if (!p.alive && !p.soaked && !p.revenge) continue;
    if (p.revenge && !p.alive) {
      drawDuck(ctx, cx(p.x), cy(p.y), tile, p.slot, opts.colorblind);
    } else {
      const frame: 0 | 1 = Math.floor(opts.nowMs / 140) % 2 === 0 ? 0 : 1;
      drawCritter(ctx, {
        animal: p.animal,
        hat: p.hat,
        cx: cx(p.x),
        cy: cy(p.y),
        size: tile,
        facing: p.facing,
        frame,
        moving: p.moving,
        ownerSlot: p.slot,
        soaked: p.soaked,
        soakT: Math.min(1, p.soakElapsed / 750),
        colorblind: opts.colorblind,
      });
      if (!p.connected && p.alive) text(ctx, '...', cx(p.x), cy(p.y) - tile, { align: 'center', size: 7, color: '#ffd23f' });
    }
    if (p.emoteId && view.serverTick < p.emoteUntilTick) {
      drawEmote(ctx, cx(p.x), cy(p.y) - tile * 0.9, p.emoteId);
    }
  }

  particles.draw(ctx);
}

function drawEmote(ctx: CanvasRenderingContext2D, x: number, y: number, id: number): void {
  const label = EMOTE_TEXT[id] ?? '!';
  const w = label.length * 5 + 8;
  rrect(ctx, x - w / 2, y - 10, w, 12, 3, '#ffffff');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x - 3, y + 1);
  ctx.lineTo(x + 3, y + 1);
  ctx.lineTo(x, y + 5);
  ctx.closePath();
  ctx.fill();
  text(ctx, label, x, y - 4, { align: 'center', size: 7, color: '#12203f' });
}
