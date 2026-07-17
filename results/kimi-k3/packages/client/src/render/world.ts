import { CONFIG, GameState, ThemeId, ringPosToTile } from '@splash/shared';
import { ParticleSystem } from './particles.js';
import { BALLOON_SPRITE, DUCK_SPRITE, POWERUP_SPRITES, SPLASH_COLORS, THEMES, animalSprite, drawSprite, hatSprite } from './sprites.js';

export const TILE = 16;

export interface WorldView {
  theme: ThemeId;
  colorblind: boolean;
  reducedShake: boolean;
  shakeTicks: number;
  hitStopTicks: number;
  interp: (slot: number) => { x: number; y: number } | null;
  estTick: () => number;
  frameTick: number;
}

export function worldOrigin(w: number, h: number): { ox: number; oy: number } {
  return { ox: Math.floor((256 - w * TILE) / 2), oy: Math.floor((224 - h * TILE) / 2) + 4 };
}

export function drawWorld(ctx: CanvasRenderingContext2D, state: GameState, view: WorldView, particles: ParticleSystem): void {
  const theme = THEMES[view.theme]!;
  const { ox, oy } = worldOrigin(state.w, state.h);
  const tick = view.frameTick;

  ctx.save();
  if (view.shakeTicks > 0 && !view.reducedShake) {
    const mag = Math.min(3, view.shakeTicks * 0.4);
    ctx.translate(Math.round((Math.random() - 0.5) * 2 * mag), Math.round((Math.random() - 0.5) * 2 * mag));
  }

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, 256, 224);

  const estNow = view.estTick();
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const idx = y * state.w + x;
      const t = state.tiles[idx]!;
      const px = ox + x * TILE;
      const py = oy + y * TILE;
      const depth = Math.min(x, y, state.w - 1 - x, state.h - 1 - y);
      const flooded = state.tideRing > 0 && depth < state.tideRing;
      if (t === 1) {
        ctx.fillStyle = theme.boulder;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = theme.boulderHi;
        ctx.fillRect(px + 2, py + 2, TILE - 6, 3);
        ctx.fillRect(px + 2, py + 2, 3, TILE - 6);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px + 3, py + TILE - 4, TILE - 4, 3);
        ctx.fillRect(px + TILE - 4, py + 3, 3, TILE - 4);
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? theme.floorA : theme.floorB;
        ctx.fillRect(px, py, TILE, TILE);
        if (t === 2) {
          ctx.fillStyle = theme.castle;
          ctx.fillRect(px + 2, py + 4, TILE - 4, TILE - 5);
          ctx.fillStyle = theme.castleHi;
          ctx.fillRect(px + 2, py + 2, 3, 3);
          ctx.fillRect(px + 6, py + 2, 4, 3);
          ctx.fillRect(px + 11, py + 2, 3, 3);
          ctx.fillStyle = theme.castleDark;
          ctx.fillRect(px + 6, py + 9, 4, 6);
          ctx.fillRect(px + 3, py + 6, 2, 2);
          ctx.fillRect(px + 11, py + 6, 2, 2);
        }
      }
      if (flooded) {
        const shimmer = Math.sin((tick + x * 7 + y * 5) * 0.15) * 0.12 + 0.72;
        ctx.globalAlpha = shimmer;
        ctx.fillStyle = theme.water;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.globalAlpha = 1;
        if ((x * 3 + y + Math.floor(tick / 20)) % 4 === 0) {
          ctx.fillStyle = theme.waterHi;
          ctx.fillRect(px + 3, py + 4, 4, 1);
          ctx.fillRect(px + 9, py + 10, 4, 1);
        }
      }
    }
  }

  for (const pu of state.exposedPowerUps) {
    const spr = POWERUP_SPRITES[pu.kind];
    if (!spr) continue;
    const bob = Math.sin((tick + pu.id * 13) * 0.12) * 1.5;
    const px = ox + pu.tx * TILE + 4;
    const py = oy + pu.ty * TILE + 4 + Math.round(bob);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px, py + 9, 8, 2);
    drawSprite(ctx, spr.rows, spr.pal, px, py);
  }

  const splashColors = view.colorblind ? SPLASH_COLORS.colorblind : SPLASH_COLORS.normal;
  for (const s of state.splashes) {
    const remaining = s.untilTick - estNow;
    const frac = Math.max(0, Math.min(1, remaining / CONFIG.SPLASH_TICKS));
    for (const tIdx of s.tiles) {
      const x = tIdx % state.w;
      const y = Math.floor(tIdx / state.w);
      const px = ox + x * TILE;
      const py = oy + y * TILE;
      const grow = 1 - frac;
      const inset = Math.round(grow * 3);
      const c0 = splashColors[0] ?? '#73eff7';
      const c1 = splashColors[1] ?? '#41a6f6';
      const c3 = splashColors[3] ?? '#ffffff';
      ctx.globalAlpha = 0.35 + 0.65 * frac;
      ctx.fillStyle = c0;
      ctx.fillRect(px + inset, py + inset, TILE - inset * 2, TILE - inset * 2);
      ctx.fillStyle = c3;
      const c = TILE / 2;
      ctx.fillRect(px + c - 1, py + c - 1, 2, 2);
      ctx.fillStyle = c1;
      ctx.fillRect(px + c - 1, py + 2, 2, 3);
      ctx.fillRect(px + c - 1, py + TILE - 5, 2, 3);
      ctx.fillRect(px + 2, py + c - 1, 3, 2);
      ctx.fillRect(px + TILE - 5, py + c - 1, 3, 2);
      ctx.globalAlpha = 1;
    }
  }

  for (const b of state.balloons) {
    const fuseLeft = b.burstTick - estNow;
    const progress = 1 - Math.max(0, Math.min(1, fuseLeft / CONFIG.FUSE_TICKS));
    const wobble = Math.sin(tick * (0.2 + progress * 0.6)) * (1 + progress * 2);
    const cx = ox + b.fx * TILE;
    const cy = oy + b.fy * TILE;
    const scale = 1 + Math.sin(tick * (0.3 + progress * 0.8)) * (0.05 + progress * 0.18);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(Math.round(cx - 4), Math.round(cy + 5), 8, 2);
    ctx.save();
    ctx.translate(Math.round(cx + wobble), Math.round(cy));
    ctx.scale(scale, scale);
    if (progress > 0.75 && Math.floor(tick / 4) % 2 === 0) {
      drawSprite(ctx, BALLOON_SPRITE.rows, { W: '#e04343', S: '#c7cfd4' }, -4, -5);
    } else {
      drawSprite(ctx, BALLOON_SPRITE.rows, BALLOON_SPRITE.pal, -4, -5);
    }
    ctx.restore();
  }

  for (const p of state.players) {
    if (p.isDuck) {
      const { tx, ty, inward } = ringPosToTile(state, p.duckPos);
      const out: Record<number, { x: number; y: number }> = {
        1: { x: 0, y: -0.85 },
        2: { x: 0.85, y: 0 },
        3: { x: 0, y: 0.85 },
        4: { x: -0.85, y: 0 },
      };
      const o = out[inward]!;
      const px = ox + (tx + 0.5 + o.x) * TILE - 6;
      const py = oy + (ty + 0.5 + o.y) * TILE - 5;
      const bob = Math.sin(tick * 0.1 + p.slot) * 1.5;
      drawSprite(ctx, DUCK_SPRITE.rows, DUCK_SPRITE.pal, Math.round(px), Math.round(py + bob));
      continue;
    }
    if (!p.alive) continue;
    const pos = view.interp(p.slot) ?? { x: p.x, y: p.y };
    const px = Math.round(ox + pos.x * TILE - 6);
    const py = Math.round(oy + pos.y * TILE - 8);
    const moving = p.dir !== 0;
    const frame = moving && Math.floor(tick / 6) % 2 === 1 ? 1 : 0;
    const meta = playerMeta(p.slot);
    const spr = animalSprite(meta.animal, frame as 0 | 1);
    drawSprite(ctx, spr.rows, spr.pal, px, py - (spr.rows.length - 12));
    const hat = hatSprite(meta.hat);
    if (hat) {
      drawSprite(ctx, hat.rows, hat.pal, px, py - (spr.rows.length - 12) - 1);
    }
    if (p.emoteId >= 0 && p.emoteUntilTick > estNow) {
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(px - 1, py - 12, 14, 9);
      ctx.fillStyle = '#1a1c2c';
      const notes = ['QK', 'RB', 'SQ', 'HN'];
      ctx.font = '6px monospace';
      ctx.fillText(notes[p.emoteId] ?? '!!', px + 1, py - 5);
    }
  }

  particles.draw(ctx);
  ctx.restore();
}

import { AnimalId, HatId } from '@splash/shared';

let metaProvider: (slot: number) => { animal: AnimalId; hat: HatId } = () => ({ animal: 'frog', hat: 'none' });

export function setPlayerMetaProvider(fn: (slot: number) => { animal: AnimalId; hat: HatId }): void {
  metaProvider = fn;
}

function playerMeta(slot: number): { animal: AnimalId; hat: HatId } {
  return metaProvider(slot);
}
