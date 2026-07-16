import type { FunStats, Placement } from '@splash/shared';
import { panel, pixelBg, text, W, H } from './common.js';

export function drawResults(
  ctx: CanvasRenderingContext2D,
  tick: number,
  placements: Placement[],
  funStats: FunStats,
  ratingDeltas: Record<string, number> | undefined,
  xp: Record<string, number>,
  localId: string,
  rematchEligible: boolean,
  rematchVotes: Record<string, boolean>,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'MATCH RESULTS', W / 2, 16, '#4fc3f7', 12, 'center');
  panel(ctx, 16, 28, W - 32, 120);

  placements.forEach((p, i) => {
    const y = 44 + i * 22;
    const isLocal = p.playerId === localId;
    const medal = p.placement === 1 ? '1st' : p.placement === 2 ? '2nd' : p.placement === 3 ? '3rd' : `${p.placement}th`;
    text(ctx, medal, 28, y, p.placement === 1 ? '#fff59d' : '#aaa', 8);
    text(ctx, p.nickname.split('#')[0]!.slice(0, 12), 55, y, isLocal ? '#4fc3f7' : '#fff', 7);
    text(ctx, `R${p.roundsWon}  S${p.soaks}`, 150, y, '#81d4fa', 6);
    const xpe = xp[p.playerId] ?? p.xpEarned;
    text(ctx, `+${xpe}xp`, 200, y, '#a5d6a7', 6);
    if (ratingDeltas && ratingDeltas[p.playerId] !== undefined) {
      const d = ratingDeltas[p.playerId]!;
      text(ctx, d >= 0 ? `+${d}` : `${d}`, 230, y, d >= 0 ? '#4caf50' : '#e53935', 6);
    }
  });

  // Fun stats
  text(ctx, 'FUN STATS', W / 2, 158, '#fff59d', 7, 'center');
  if (funStats.mostSoaks)
    text(ctx, `Most Soaks: ${funStats.mostSoaks.nickname.split('#')[0]} (${funStats.mostSoaks.value})`, W / 2, 170, '#ccc', 5, 'center');
  if (funStats.castleCrusher)
    text(ctx, `Castle Crusher: ${funStats.castleCrusher.nickname.split('#')[0]} (${funStats.castleCrusher.value})`, W / 2, 180, '#ccc', 5, 'center');
  if (funStats.biggestChain > 1)
    text(ctx, `Biggest Chain: ${funStats.biggestChain}`, W / 2, 190, '#ccc', 5, 'center');

  if (rematchEligible) {
    const votes = Object.values(rematchVotes).filter(Boolean).length;
    text(ctx, `[R] Rematch (${votes})  [Enter] Continue`, W / 2, H - 8, '#888', 6, 'center');
  } else {
    text(ctx, '[Enter] Continue', W / 2, H - 8, '#888', 6, 'center');
  }
}
