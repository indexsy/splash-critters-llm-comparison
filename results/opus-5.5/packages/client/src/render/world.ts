// World renderer: the arena for one round, drawn into the 256x224 backbuffer. The static tile
// layer is cached offscreen (patched when castles wash away); everything that moves is drawn
// on top each frame in ground -> y-sorted sprites -> air order, clipped to the arena.
import type { MatchPlayerInfo, RoundState, Theme } from '@splash/shared';
import type { ActorView, Scene } from '../game/scene';
import { subToPx, type ArenaLayout } from './camera';
import type { Fx } from './fx';
import { ctx2d, makeCanvas } from './pixelart';
import { TILE, drawArena, drawArenaTile } from './tiles';
import { drawCritter, drawDuck, drawEmote, drawFloater, drawSoak, drawYouMarker, type ActorArt } from './world-actors';
import { balloonCenter, drawBalloon, drawGhostBalloon, drawLobs, drawSplashes } from './world-hazards';
import { drawCrumbles, drawFlood, drawItems, drawRings } from './world-terrain';

/** The "YOU" marker shows through the countdown and this many ticks into the round. */
const YOU_MARKER_TICKS = 75;

interface Sprite {
  y: number;
  draw: () => void;
}

export class WorldRenderer {
  private cache: HTMLCanvasElement | null = null;
  private theme: Theme = 'backyard';
  private seed = 0;

  /** Rebuild the static arena layer for a new round (theme, tiles, decoration seed). */
  prepare(s: RoundState, theme: Theme, seed: number): void {
    this.theme = theme;
    this.seed = seed;
    const cv = makeCanvas(s.w * TILE, s.h * TILE);
    drawArena(ctx2d(cv), theme, s.tiles, s.w, s.h, seed);
    this.cache = cv;
  }

  /** Patch the static layer after a castle washed away (the tile below carries its shadow). */
  washTile(s: RoundState, tx: number, ty: number): void {
    if (!this.cache) return;
    const ctx = ctx2d(this.cache);
    for (const y of [ty, ty + 1]) {
      if (y < s.h) drawArenaTile(ctx, this.theme, s.tiles, s.w, s.h, tx, y, this.seed, tx * TILE, y * TILE);
    }
  }

  draw(ctx: CanvasRenderingContext2D, scene: Scene, fx: Fx, layout: ArenaLayout, shake: { x: number; y: number }): void {
    const s = scene.world;
    if (!s || !this.cache) return;
    const ox = layout.ax + shake.x;
    const oy = layout.ay + shake.y;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, layout.aw, layout.ah);
    ctx.clip();
    ctx.drawImage(this.cache, ox, oy);
    this.drawGround(ctx, scene, s, fx, ox, oy);
    for (const sprite of this.collectSprites(ctx, scene, s, fx, ox, oy).sort((a, b) => a.y - b.y)) sprite.draw();
    drawLobs(ctx, fx.lobs, ox, oy, scene.nowMs, scene.colorblind);
    fx.particles.draw(ctx, ox, oy);
    this.drawOverheads(ctx, scene, fx, ox, oy);
    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D, scene: Scene, s: RoundState, fx: Fx, ox: number, oy: number): void {
    drawFlood(ctx, s, this.theme, this.seed, ox, oy, fx, scene.nowMs);
    drawCrumbles(ctx, this.theme, ox, oy, fx, scene.nowMs);
    drawSplashes(ctx, fx.splashes, ox, oy, scene.nowMs, scene.colorblind);
    drawItems(ctx, s, ox, oy, fx, scene.nowMs);
    drawRings(ctx, ox, oy, fx, scene.nowMs);
  }

  private collectSprites(ctx: CanvasRenderingContext2D, scene: Scene, s: RoundState, fx: Fx, ox: number, oy: number): Sprite[] {
    const { nowMs, estTick, colorblind } = scene;
    const out: Sprite[] = [];
    for (const b of s.balloons) {
      if (fx.lobInFlight(b.id, nowMs)) continue;
      const own = scene.ownSlides.get(b.id);
      const c = own ? { x: subToPx(own.x), y: subToPx(own.y) } : balloonCenter(b, estTick, s.tick);
      out.push({ y: c.y, draw: () => drawBalloon(ctx, b, ox + c.x, oy + c.y, estTick, colorblind) });
    }
    for (const d of scene.drops) {
      out.push({ y: d.ty * TILE + TILE / 2, draw: () => drawGhostBalloon(ctx, d.tx, d.ty, d.slot, ox, oy, colorblind) });
    }
    for (const [slot, soak] of fx.soaks) {
      const art = artFor(scene, slot);
      if (art) out.push({ y: subToPx(soak.y) - 1, draw: () => drawSoak(ctx, soak, slot, art, ox, oy, nowMs) });
    }
    for (const a of scene.actors) {
      const art = artFor(scene, a.slot);
      if (!art) continue;
      if (a.alive) {
        const cx = ox + subToPx(a.x);
        const cy = oy + subToPx(a.y);
        out.push({ y: subToPx(a.y), draw: () => drawCritter(ctx, a, art, cx, cy, nowMs) });
      } else if (a.duck) {
        const duck = a.duck;
        const bounds = { left: ox, top: oy, right: ox + s.w * TILE };
        out.push({ y: subToPx(duck.y), draw: () => drawDuck(ctx, a, art, bounds, ox + subToPx(duck.x), oy + subToPx(duck.y), nowMs) });
      }
    }
    return out;
  }

  /** Emote bubbles and the local "YOU" marker, above every sprite. */
  private drawOverheads(ctx: CanvasRenderingContext2D, scene: Scene, fx: Fx, ox: number, oy: number): void {
    const showYou = scene.phase === 'countdown' || (scene.phase === 'live' && scene.estTick < YOU_MARKER_TICKS && !scene.round?.resumed);
    for (const a of scene.actors) {
      const head = headOf(a);
      if (!head) continue;
      const hx = ox + subToPx(head.x);
      const hy = oy + subToPx(head.y) - head.lift;
      const emote = fx.emotes.get(a.slot);
      if (emote) drawEmote(ctx, emote, hx, hy, oy, scene.nowMs);
      else if (a.local && a.alive && showYou) drawYouMarker(ctx, hx, hy, a.slot, scene.colorblind, oy, scene.nowMs);
    }
    for (const f of fx.floaters) drawFloater(ctx, f, ox, oy, oy, scene.nowMs);
  }
}

/** Anchor for things drawn over a critter's head (sub-unit center + pixels up to its top). */
function headOf(a: ActorView): { x: number; y: number; lift: number } | null {
  if (a.alive) return { x: a.x, y: a.y, lift: 12 };
  if (a.duck) return { x: a.duck.x, y: a.duck.y, lift: 19 };
  return null;
}

function artFor(scene: Scene, slot: number): ActorArt | null {
  const info: MatchPlayerInfo | undefined = scene.config.players.find((p) => p.slot === slot);
  return info ? { info, colorblind: scene.colorblind } : null;
}
