// Timed overlays over the arena: the 3-2-1-SPLASH! countdown synced to round_start.startTime,
// and the "waiting" card shown while a match (re)connects.
import type { IntroPhase } from '../game/clock';
import { SCREEN_H, SCREEN_W, type ArenaLayout } from './camera';
import { drawText, measureText } from './font';
import { dim } from './hud-parts';
import { drawLabel, labelCanvas } from './label';
import { PAL } from './palette';
import { getLogo } from './sprites';

const NUMBER_BANDS = [PAL.white, PAL.yellowLight, PAL.yellow, PAL.orange] as const;
const GO_BANDS = [PAL.foam, PAL.skyLight, PAL.sky, PAL.blue] as const;

/** A title ("ROUND n") over a big punching 3 / 2 / 1, then "SPLASH!". */
export function drawCountdown(ctx: CanvasRenderingContext2D, phase: IntroPhase, title: string, layout: ArenaLayout): void {
  if (phase.kind === 'none') return;
  const cx = layout.ax + layout.aw / 2;
  const cy = layout.ay + layout.ah / 2;
  if (phase.kind === 'count') {
    dim(ctx, layout.ax, layout.ay, layout.aw, layout.ah, 0.25);
    drawLabel(ctx, title, cx, cy - 46, { scale: 2, bands: [PAL.sand, PAL.tan] });
    const scale = phase.elapsed < 90 ? 4 : 3;
    const size = labelCanvas(String(phase.n), { scale, bands: NUMBER_BANDS, bold: true });
    ctx.drawImage(size, Math.round(cx - size.width / 2), Math.round(cy - size.height / 2 + 8));
    return;
  }
  const blink = phase.elapsed > 560 && Math.floor(phase.elapsed / 70) % 2 === 1;
  if (blink) return;
  const go = labelCanvas('SPLASH!', { scale: 2, bands: GO_BANDS, bold: true });
  const rise = phase.elapsed < 90 ? 4 : 0;
  ctx.drawImage(go, Math.round(cx - go.width / 2), Math.round(cy - go.height / 2 - rise));
}

/** Full-screen card while there is no match to show yet (joining, reconnecting). */
export function drawWaiting(ctx: CanvasRenderingContext2D, text: string, nowMs: number): void {
  ctx.fillStyle = PAL.navy;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const logo = getLogo();
  ctx.drawImage(logo, Math.round((SCREEN_W - logo.width) / 2), 56);
  // Left-aligned from the centred position of the bare text so the animated dots never shift it.
  const dots = '.'.repeat(1 + (Math.floor(nowMs / 400) % 3));
  const x = Math.round((SCREEN_W - measureText(text)) / 2);
  drawText(ctx, `${text}${dots}`, x, 120, { color: PAL.cloud, shadow: PAL.ink });
}
