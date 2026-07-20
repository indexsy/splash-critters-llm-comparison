/**
 * In-canvas HUD: top per-player strip (icon, name, round pips, live stats, ping),
 * plus the kill feed and centred announcer pops.
 */

import type { MatchConfig, Snapshot } from '@splash/shared';
import { slotColor } from '../theme';
import { rect, rrect, text, VH, VW, withAlpha } from './pixel';
import { drawCritter } from './sprites';

export const HUD_H = 28;

export interface FeedItem {
  text: string;
  ms: number;
  color: string;
}

export interface Announce {
  text: string;
  ms: number;
  color: string;
  big: boolean;
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot | null,
  config: MatchConfig,
  ping: number,
  roundNo: number,
  nowMs: number,
  colorblind: boolean,
): void {
  rect(ctx, 0, 0, VW, HUD_H, '#0a1130');
  rect(ctx, 0, HUD_H - 2, VW, 2, '#2a3a80');

  const n = config.players.length;
  const cardW = VW / n;
  for (let i = 0; i < n; i++) {
    const id = config.players[i];
    const p = snap?.players.find((s) => s.slot === id.slot);
    const x0 = i * cardW;
    const dead = p ? !p.alive : false;

    // mini icon
    withAlpha(ctx, dead ? 0.4 : 1, () =>
      drawCritter(ctx, {
        animal: id.animal,
        hat: id.hat,
        cx: x0 + 12,
        cy: 15,
        size: 15,
        facing: 'down',
        frame: 0,
        moving: false,
        ownerSlot: id.slot,
        colorblind,
      }),
    );

    const name = id.name.split('#')[0].slice(0, 7);
    text(ctx, name, x0 + 22, 8, { size: 8, color: dead ? '#7f8bb0' : '#eaf2ff' });

    // round pips
    const wins = p?.roundWins ?? 0;
    for (let w = 0; w < config.roundsToWin; w++) {
      const filled = w < wins;
      rect(ctx, x0 + 22 + w * 6, 14, 4, 4, filled ? slotColor(id.slot, colorblind) : '#28325f');
    }
    // stats
    if (p) text(ctx, `${p.activeBalloons}/${p.maxBalloons} r${p.range}`, x0 + 22, 24, { size: 7, color: '#9fb4e6' });
    if (dead) text(ctx, 'OUT', x0 + 2, 24, { size: 7, color: '#ff5d73' });
  }

  // round + ping tucked into the top divider strip so they don't collide with cards
  const n2 = config.players.length;
  if (n2 <= 2) {
    text(ctx, `ROUND ${roundNo}`, VW / 2, 6, { size: 7, align: 'center', color: '#ffd23f' });
  }
  text(ctx, `${ping}ms`, VW - 2, HUD_H - 4, { size: 6, align: 'right', color: '#6f83bb' });
}

export function drawFeed(ctx: CanvasRenderingContext2D, feed: FeedItem[], nowMs: number): void {
  let y = VH - 8;
  for (let i = feed.length - 1; i >= 0 && i >= feed.length - 4; i--) {
    const item = feed[i];
    const age = nowMs - item.ms;
    const a = age > 3000 ? Math.max(0, 1 - (age - 3000) / 1000) : 1;
    withAlpha(ctx, a, () => text(ctx, item.text, 4, y, { size: 7, color: item.color, shadow: '#000' }));
    y -= 9;
  }
}

export function drawAnnounce(ctx: CanvasRenderingContext2D, ann: Announce | null, nowMs: number): void {
  if (!ann) return;
  const age = nowMs - ann.ms;
  if (age > 1400) return;
  const scale = age < 150 ? age / 150 : 1;
  const size = (ann.big ? 22 : 14) * (0.6 + scale * 0.4);
  const a = age > 1000 ? Math.max(0, 1 - (age - 1000) / 400) : 1;
  withAlpha(ctx, a, () => {
    text(ctx, ann.text, VW / 2, VH * 0.38, { size, align: 'center', color: ann.color, shadow: '#08102a' });
  });
}

export function drawBanner(ctx: CanvasRenderingContext2D, msg: string, sub: string): void {
  const w = 180;
  const h = 46;
  rrect(ctx, (VW - w) / 2, (VH - h) / 2, w, h, 6, '#0c1636cc');
  text(ctx, msg, VW / 2, VH / 2 - 6, { size: 16, align: 'center', color: '#ffd23f', shadow: '#000' });
  text(ctx, sub, VW / 2, VH / 2 + 10, { size: 8, align: 'center', color: '#eaf2ff' });
}
