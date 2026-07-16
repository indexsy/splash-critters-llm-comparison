import type { GameMode } from '@splash/shared';
import { pixelBg, text, W, H } from './common.js';

export function drawQueue(
  ctx: CanvasRenderingContext2D,
  tick: number,
  mode: GameMode,
  elapsed: number,
  searchRange: number,
  eta: number,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'FINDING MATCH', W / 2, 50, '#4fc3f7', 12, 'center');
  text(ctx, mode === 'duel' ? 'Ranked Duel' : 'Ranked Free-for-All', W / 2, 70, '#fff59d', 8, 'center');

  // Spinner
  const dots = '.'.repeat((Math.floor(tick / 15) % 3) + 1);
  text(ctx, `Searching${dots}`, W / 2, 100, '#fff', 8, 'center');
  text(ctx, `Time: ${elapsed}s`, W / 2, 120, '#aaa', 7, 'center');
  text(ctx, `Range: ±${searchRange} Elo`, W / 2, 135, '#81d4fa', 7, 'center');
  text(ctx, `ETA: ~${eta}s`, W / 2, 150, '#888', 7, 'center');
  text(ctx, '[Esc] Cancel', W / 2, H - 20, '#666', 6, 'center');
}
