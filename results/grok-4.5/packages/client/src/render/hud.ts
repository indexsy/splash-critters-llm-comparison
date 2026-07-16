import type { MatchConfig, Snapshot } from '@splash/shared';
import { PAL, drawAnimal } from './sprites.js';

export function drawHud(
  ctx: CanvasRenderingContext2D,
  config: MatchConfig,
  snap: Snapshot | null,
  scores: Record<string, number>,
  localId: string | null,
  ping: number,
  announcer: string | null,
  killFeed: string[],
  W: number,
  H: number,
): void {
  // Top bar
  ctx.fillStyle = '#000000aa';
  ctx.fillRect(0, 0, W, 16);

  let hx = 4;
  for (const p of config.players) {
    const sp = snap?.players.find((s) => s.id === p.id);
    const alive = sp ? sp.alive && !sp.soaked : true;
    ctx.globalAlpha = alive ? 1 : 0.4;
    drawAnimal(ctx, hx + 6, 8, p.animal, p.hat, 'down', 0, 0.7);
    ctx.fillStyle = p.id === localId ? '#fff59d' : PAL.white;
    ctx.font = '6px monospace';
    ctx.textAlign = 'left';
    const name = p.nickname.split('#')[0]!.slice(0, 8);
    ctx.fillText(name, hx + 12, 7);
    ctx.fillStyle = '#81d4fa';
    ctx.fillText(`${scores[p.id] ?? 0}`, hx + 12, 14);
    if (sp) {
      ctx.fillStyle = '#aaa';
      ctx.fillText(`B${sp.balloonCount} S${sp.splashRange}`, hx + 22, 14);
    }
    ctx.globalAlpha = 1;
    hx += 62;
  }

  // Ping
  ctx.fillStyle = '#888';
  ctx.font = '6px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${ping}ms`, W - 4, 10);

  // Kill feed
  ctx.textAlign = 'left';
  ctx.font = '6px monospace';
  killFeed.slice(-4).forEach((line, i) => {
    ctx.fillStyle = '#ffffffcc';
    ctx.fillText(line, 4, 28 + i * 8);
  });

  // Announcer
  if (announcer) {
    ctx.fillStyle = '#00000088';
    ctx.fillRect(W / 2 - 60, H / 2 - 16, 120, 20);
    ctx.fillStyle = '#fff59d';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(announcer, W / 2, H / 2 - 2);
  }
}
