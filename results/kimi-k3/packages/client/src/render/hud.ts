import type { AnimalId, HatId, Snapshot } from '@splash/shared';
import { tierForRating } from '@splash/shared';
import { ANIMAL_COLORS, P, W, drawAnimal, drawPixelRect, drawText } from './sprites.js';

export interface HudPlayer {
  slot: number;
  nickname: string;
  animal: AnimalId;
  hat: HatId;
  rating: number | null;
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot | null,
  players: HudPlayer[],
  localSlot: number,
  ping: number,
  killFeed: { text: string; life: number }[],
  announcer: { text: string; life: number } | null,
  shake: { x: number; y: number },
): void {
  ctx.save();
  ctx.translate(shake.x, shake.y);

  // top bar
  drawPixelRect(ctx, 0, 0, W, 14, 'rgba(15,15,26,0.85)');
  if (snap) {
    const alive = snap.players.filter((p) => p.alive && !p.isDuck).length;
    drawText(ctx, `R${snap.roundNo}`, 4, 3, P.gold);
    drawText(ctx, `${alive} dry`, 28, 3, P.splash);
    if (snap.tideRing > 0) drawText(ctx, 'TIDE!', 70, 3, P.red);
    drawText(ctx, `${ping}ms`, W - 36, 3, P.gray);
  }

  // player panels
  const slots = players.slice(0, 4);
  slots.forEach((hp, i) => {
    const sp = snap?.players.find((p) => p.slot === hp.slot);
    const x = 2 + (i % 2) * 128;
    const y = H_BOTTOM(i);
    const bg = hp.slot === localSlot ? 'rgba(30,60,90,0.9)' : 'rgba(20,30,50,0.85)';
    drawPixelRect(ctx, x, y, 124, 22, bg);
    drawAnimal(ctx, x + 2, y + 2, hp.animal, hp.hat, 3, 0, sp ? !sp.alive : false);
    drawText(ctx, hp.nickname.slice(0, 10), x + 20, y + 2, P.white);
    if (sp) {
      drawText(ctx, `B${sp.balloonCount} R${sp.splashRange}`, x + 20, y + 11, P.gray);
      drawText(ctx, `${sp.roundWins}W`, x + 100, y + 2, P.gold);
    }
    if (hp.rating != null) {
      drawText(ctx, tierForRating(hp.rating).slice(0, 4), x + 90, y + 11, P.accent);
    }
  });

  // kill feed
  killFeed.forEach((k, i) => {
    ctx.globalAlpha = Math.min(1, k.life / 30);
    drawText(ctx, k.text, 4, 16 + i * 9, P.white);
  });
  ctx.globalAlpha = 1;

  // announcer
  if (announcer && announcer.life > 0) {
    ctx.globalAlpha = Math.min(1, announcer.life / 20);
    const tw = ctx.measureText(announcer.text).width;
    drawPixelRect(ctx, (W - tw) / 2 - 6, 90, tw + 12, 16, 'rgba(0,0,0,0.7)');
    drawText(ctx, announcer.text, (W - tw) / 2, 94, P.gold);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function H_BOTTOM(i: number): number {
  return i < 2 ? 202 : 202; // all bottom — actually stack top corners for 4p
}

// fix layout: 4 corners style mini
export function drawHudCorners(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot | null,
  players: HudPlayer[],
  localSlot: number,
  ping: number,
  killFeed: { text: string; life: number }[],
  announcer: { text: string; life: number } | null,
  shake: { x: number; y: number },
  frame: number,
): void {
  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawPixelRect(ctx, 0, 0, W, 12, 'rgba(15,15,26,0.8)');
  if (snap) {
    drawText(ctx, `Round ${snap.roundNo}`, 4, 2, P.gold);
    const scores = snap.players.map((p) => p.roundWins).join('-');
    drawText(ctx, scores, 70, 2, P.white);
    if (snap.phase === 'countdown') drawText(ctx, 'READY', 120, 2, P.accent);
    if (snap.tideRing > 0) drawText(ctx, `TIDE ${snap.tideRing}`, 160, 2, P.red);
    drawText(ctx, `${ping}ms`, W - 32, 2, P.gray);
  }

  const pos = [
    { x: 2, y: 14 },
    { x: W - 70, y: 14 },
    { x: 2, y: H - 28 },
    { x: W - 70, y: H - 28 },
  ];
  // import H
  const HH = 224;
  pos[2]!.y = HH - 28;
  pos[3]!.y = HH - 28;

  players.forEach((hp, i) => {
    const p = pos[i] ?? pos[0]!;
    const sp = snap?.players.find((x) => x.slot === hp.slot);
    drawPixelRect(ctx, p.x, p.y, 68, 24, hp.slot === localSlot ? 'rgba(40,80,120,0.85)' : 'rgba(20,30,50,0.8)');
    drawAnimal(ctx, p.x + 1, p.y + 4, hp.animal, hp.hat, 3, frame, sp ? !sp.alive && !sp.isDuck : false);
    drawText(ctx, hp.nickname.slice(0, 8), p.x + 18, p.y + 3, P.white);
    if (sp) {
      drawText(ctx, `×${sp.roundWins}`, p.x + 18, p.y + 12, P.gold);
      if (!sp.alive) drawText(ctx, sp.isDuck ? 'DUCK' : 'SOAK', p.x + 40, p.y + 12, P.splash);
    }
  });

  killFeed.forEach((k, i) => {
    ctx.globalAlpha = Math.min(1, k.life / 40);
    drawText(ctx, k.text, 80, 16 + i * 9, P.white);
  });
  ctx.globalAlpha = 1;

  if (announcer && announcer.life > 0) {
    ctx.globalAlpha = Math.min(1, announcer.life / 15);
    ctx.font = '12px monospace';
    const tw = ctx.measureText(announcer.text).width;
    drawPixelRect(ctx, (W - tw) / 2 - 8, 96, tw + 16, 18, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = P.gold;
    ctx.fillText(announcer.text, (W - tw) / 2, 100);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

const H = 224;
