// Ground-level layers of the arena: rising-tide water (with foam edges and pillars standing in
// the flood), castle crumble animations, exposed power-ups bobbing, and expanding water rings.
import { Dir, PowerUp, Tile, ringIndex, type DirCode, type PowerUpKind, type RoundState, type Theme } from '@splash/shared';
import { ITEM_FRAMES, ITEM_FRAME_MS, getItem, getShadow } from './sprites';
import { hashInts } from './pixelart';
import { CRUMBLE_FRAME_MS, FLOOD_FILL_MS, ITEM_POP_MS, type Fx, type RingFx } from './fx';
import { TILE, WATER_FRAME_MS, getCastleCrumble, getPillarTile, getWaterEdge, getWaterTile } from './tiles';

const EDGE_DIRS: readonly [DirCode, number, number][] = [
  [Dir.Up, 0, -1],
  [Dir.Down, 0, 1],
  [Dir.Left, -1, 0],
  [Dir.Right, 1, 0],
];

/** Same deterministic pillar variant the static arena layer uses (tiles.ts drawArenaTile). */
function pillarVariant(tx: number, ty: number, seed: number): number {
  return (hashInts(tx, ty, seed, 7) >> 1) & 1;
}

/**
 * Tide water on every flooded tile (ring 1..tideLevel), foam where it meets dry ground and the
 * pillars redrawn standing in it. The newest ring fades in over FLOOD_FILL_MS.
 */
export function drawFlood(ctx: CanvasRenderingContext2D, s: RoundState, theme: Theme, seed: number, ox: number, oy: number, fx: Fx, nowMs: number): void {
  const level = s.tideLevel;
  if (level <= 0) return;
  const frame = Math.floor(nowMs / WATER_FRAME_MS);
  const filling = fx.flood.level === level ? Math.min(1, (nowMs - fx.flood.startMs) / FLOOD_FILL_MS) : 1;
  for (let ty = 1; ty < s.h - 1; ty++) {
    for (let tx = 1; tx < s.w - 1; tx++) {
      const ring = ringIndex(s.w, s.h, tx, ty);
      if (ring < 1 || ring > level) continue;
      const px = ox + tx * TILE;
      const py = oy + ty * TILE;
      ctx.globalAlpha = ring === level ? filling : 1;
      ctx.drawImage(getWaterTile(frame), px, py);
      for (const [dir, dx, dy] of EDGE_DIRS) {
        const nring = ringIndex(s.w, s.h, tx + dx, ty + dy);
        if (nring > level) ctx.drawImage(getWaterEdge(dir, frame), px, py);
      }
      ctx.globalAlpha = 1;
      if (s.tiles[ty * s.w + tx] === Tile.Boulder) ctx.drawImage(getPillarTile(theme, pillarVariant(tx, ty, seed)), px, py);
    }
  }
}

/** Crumbling sand over castles that were just washed away. */
export function drawCrumbles(ctx: CanvasRenderingContext2D, theme: Theme, ox: number, oy: number, fx: Fx, nowMs: number): void {
  for (const c of fx.crumbles) {
    const frame = Math.floor((nowMs - c.startMs) / CRUMBLE_FRAME_MS);
    ctx.drawImage(getCastleCrumble(theme, frame), ox + c.tx * TILE, oy + c.ty * TILE);
  }
}

/** Exposed power-ups: a shine sweep, a 1 px bob, and a hop when freshly revealed. */
export function drawItems(ctx: CanvasRenderingContext2D, s: RoundState, ox: number, oy: number, fx: Fx, nowMs: number): void {
  for (let i = 0; i < s.items.length; i++) {
    const kind = s.items[i];
    if (kind === PowerUp.None) continue;
    const tx = i % s.w;
    const ty = Math.floor(i / s.w);
    const phase = (tx * 3 + ty * 5) * 90;
    const sprite = getItem(kind as PowerUpKind, Math.floor((nowMs + phase) / ITEM_FRAME_MS) % ITEM_FRAMES);
    if (!sprite) continue;
    const pop = fx.pops.find((p) => p.tx === tx && p.ty === ty);
    const hop = pop ? Math.round(Math.sin(Math.min(1, (nowMs - pop.startMs) / ITEM_POP_MS) * Math.PI) * 5) : 0;
    const bob = Math.sin((nowMs + phase) / 260) > 0 ? 1 : 0;
    const px = ox + tx * TILE;
    const py = oy + ty * TILE;
    ctx.drawImage(getShadow(10), px + 3, py + 12);
    ctx.drawImage(sprite, px, py - 1 - bob - hop);
  }
}

/** One expanding pixel ring (tide surges, splashes landing in water). */
function drawRing(ctx: CanvasRenderingContext2D, r: RingFx, ox: number, oy: number, nowMs: number): void {
  const t = (nowMs - r.startMs) / r.durationMs;
  if (t < 0 || t >= 1) return;
  const radius = 2 + r.maxR * t;
  const steps = Math.max(12, Math.round(radius * 5));
  ctx.globalAlpha = 1 - t;
  ctx.fillStyle = r.color;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(ox + r.x + Math.cos(a) * radius), Math.round(oy + r.y + Math.sin(a) * radius * 0.6), 1, 1);
  }
  ctx.globalAlpha = 1;
}

export function drawRings(ctx: CanvasRenderingContext2D, ox: number, oy: number, fx: Fx, nowMs: number): void {
  for (const r of fx.rings) drawRing(ctx, r, ox, oy, nowMs);
}
