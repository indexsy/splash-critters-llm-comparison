import type { Screen } from './types.js';
import { audioEngine } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import type { MatchResult } from '@shared/types.js';

let result: MatchResult | null = null;
let animTimer = 0;

export const resultsScreen: Screen = {
  enter(data?: unknown) {
    if (data && typeof data === 'object' && 'placements' in data) {
      result = data as MatchResult;
    } else {
      result = null;
    }
    animTimer = 0;
    audioEngine.playMusic('results');
    if (result) audioEngine.play('victory');
  },
  update(dt: number) {
    animTimer += dt;
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    ctx.fillStyle = PALETTE.yellow;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Match Results', width / 2, 12);

    if (!result) {
      ctx.fillStyle = PALETTE.lightGray;
      ctx.font = '8px monospace';
      ctx.fillText('No results', width / 2, 112);
      return;
    }

    let y = 28;

    // Placements
    for (let i = 0; i < result.placements.length; i++) {
      const pid = result.placements[i];
      const xp = result.xp[pid] || 0;
      const ratingDelta = result.ratingDeltas[pid] || 0;
      const isWinner = i === 0;

      ctx.fillStyle = isWinner ? PALETTE.gold : 'rgba(0,0,0,0.4)';
      ctx.fillRect(20, y, 216, 22);
      ctx.fillStyle = isWinner ? PALETTE.black : PALETTE.white;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`#${i + 1}  ${pid.substring(0, 8)}`, 28, y + 8);
      ctx.textAlign = 'right';
      ctx.fillStyle = ratingDelta > 0 ? PALETTE.green : ratingDelta < 0 ? PALETTE.red : PALETTE.lightGray;
      ctx.fillText(`${ratingDelta > 0 ? '+' : ''}${ratingDelta}`, 228, y + 8);
      ctx.fillStyle = PALETTE.yellow;
      ctx.fillText(`+${xp} XP`, 228, y + 18);
      y += 26;
    }

    // Fun stats
    y = 140;
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Fun Stats', width / 2, y);
    y += 12;

    const stats = result.stats;
    ctx.fillStyle = PALETTE.lightGray;
    ctx.font = '6px monospace';
    if (stats.soaks) {
      const soaks = stats.soaks as Record<string, number>;
      const mostSoaks = Object.entries(soaks).sort((a, b) => b[1] - a[1])[0];
      if (mostSoaks) ctx.fillText(`Most Soaks: ${mostSoaks[0].substring(0, 8)} (${mostSoaks[1]})`, width / 2, y);
      y += 10;
    }
    if (stats.castlesWashed) {
      const castles = stats.castlesWashed as Record<string, number>;
      const mostCastles = Object.entries(castles).sort((a, b) => b[1] - a[1])[0];
      if (mostCastles) ctx.fillText(`Castle Crusher: ${mostCastles[0].substring(0, 8)} (${mostCastles[1]})`, width / 2, y);
      y += 10;
    }
    if (stats.biggestChain) {
      ctx.fillText(`Biggest Chain: ${stats.biggestChain}`, width / 2, y);
      y += 10;
    }
    if (stats.longestSurvivor) {
      ctx.fillText(`Longest Survivor: ${(stats.longestSurvivor as string).substring(0, 8)}`, width / 2, y);
    }

    // Continue button
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(88, 196, 80, 16);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Continue', 128, 206);
  },
  exit() {
    result = null;
  },
};
