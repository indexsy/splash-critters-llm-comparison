import type { RoomInfo } from '@splash/shared';
import { panel, pixelBg, text, W, H } from './common.js';

export function drawBrowser(
  ctx: CanvasRenderingContext2D,
  tick: number,
  rooms: RoomInfo[],
  selected: number,
  filter: 'all' | 'duel' | 'ffa',
): void {
  pixelBg(ctx, tick);
  text(ctx, 'ROOM BROWSER', W / 2, 16, '#4fc3f7', 10, 'center');
  text(ctx, `Filter: ${filter.toUpperCase()}  [F]  [R]efresh  [Esc]`, W / 2, 28, '#888', 6, 'center');

  panel(ctx, 12, 36, W - 24, H - 52);
  const filtered = rooms.filter((r) => {
    if (filter === 'duel') return r.size === 2;
    if (filter === 'ffa') return r.size === 4;
    return true;
  });

  if (filtered.length === 0) {
    text(ctx, 'No open rooms', W / 2, H / 2, '#888', 8, 'center');
    text(ctx, 'Create one from Casual menu!', W / 2, H / 2 + 14, '#666', 6, 'center');
    return;
  }

  filtered.forEach((r, i) => {
    const y = 50 + i * 18;
    if (y > H - 20) return;
    const sel = i === selected;
    if (sel) {
      ctx.fillStyle = '#4fc3f733';
      ctx.fillRect(16, y - 10, W - 32, 16);
    }
    text(ctx, r.name.slice(0, 14), 20, y, sel ? '#fff59d' : '#fff', 7);
    text(ctx, `${r.players}/${r.maxPlayers}`, 120, y, '#81d4fa', 7);
    text(ctx, r.size === 2 ? '2p' : '4p', 150, y, '#aaa', 7);
    text(ctx, r.theme.slice(0, 6), 170, y, '#888', 6);
    text(ctx, r.host.split('#')[0]!.slice(0, 8), 210, y, '#aaa', 6);
  });
}
