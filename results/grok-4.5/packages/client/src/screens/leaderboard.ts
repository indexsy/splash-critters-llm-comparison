import { panel, pixelBg, text, W, H } from './common.js';

export type LbRow = {
  rank: number;
  nickname: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
};

export function drawLeaderboard(
  ctx: CanvasRenderingContext2D,
  tick: number,
  rows: LbRow[],
  mode: 'duel' | 'ffa',
  loading: boolean,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'LEADERBOARD', W / 2, 14, '#4fc3f7', 10, 'center');
  text(ctx, `[Tab] ${mode === 'duel' ? 'DUEL' : 'FFA'}  [Esc] Back`, W / 2, 26, '#888', 6, 'center');
  panel(ctx, 8, 34, W - 16, H - 48);

  if (loading) {
    text(ctx, 'Loading...', W / 2, H / 2, '#888', 8, 'center');
    return;
  }
  if (rows.length === 0) {
    text(ctx, 'No ranked games yet', W / 2, H / 2, '#888', 8, 'center');
    return;
  }

  text(ctx, '#  NAME            RATING  TIER     WR', 16, 46, '#666', 5);
  rows.slice(0, 14).forEach((r, i) => {
    const y = 58 + i * 10;
    text(ctx, String(r.rank).padStart(2), 16, y, '#fff59d', 6);
    text(ctx, r.nickname.slice(0, 14), 32, y, '#fff', 6);
    text(ctx, String(r.rating), 130, y, '#81d4fa', 6);
    text(ctx, r.tier.slice(0, 7), 165, y, '#a5d6a7', 6);
    text(ctx, `${r.winrate}%`, 215, y, '#ccc', 6);
  });
}
