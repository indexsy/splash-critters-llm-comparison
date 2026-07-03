import type { Screen } from './types.js';
import { PALETTE } from '../render/sprites.js';
import type { LeaderboardEntry } from '@shared/types.js';
import type { QueueMode } from '@shared/types.js';

let entries: LeaderboardEntry[] = [];
let mode: QueueMode = 'duel';
let loading = true;
let error = '';

async function fetchLeaderboard(m: QueueMode) {
  loading = true;
  error = '';
  try {
    const res = await fetch(`/api/leaderboard?mode=${m}`);
    if (!res.ok) throw new Error('Failed to fetch');
    entries = await res.json() as LeaderboardEntry[];
  } catch (e) {
    error = 'Offline';
    entries = generateMockLeaderboard(m);
  }
  loading = false;
}

function generateMockLeaderboard(m: QueueMode): LeaderboardEntry[] {
  const mock: LeaderboardEntry[] = [];
  for (let i = 1; i <= 20; i++) {
    mock.push({
      rank: i,
      nickname: `Player${i}`,
      tag: `${1000 + i}`,
      rating: m === 'duel' ? 1000 + i * 30 : 1000 + i * 25,
      tier: 'Pond',
      games: 50 + i * 10,
      winrate: 0.4 + (i % 10) * 0.05,
    });
  }
  return mock;
}

export const leaderboardScreen: Screen = {
  enter(_data?: unknown) {
    fetchLeaderboard(mode);
  },
  update(_dt: number) {
    /* nothing */
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Leaderboard', width / 2, 12);

    // Tabs
    const tabs: { label: string; m: QueueMode }[] = [
      { label: 'Duel', m: 'duel' },
      { label: 'FFA', m: 'ffa' },
    ];
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const x = 80 + i * 50;
      ctx.fillStyle = mode === t.m ? PALETTE.blue : PALETTE.darkGray;
      ctx.fillRect(x, 18, 46, 12);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.label, x + 23, 26);
    }

    if (loading) {
      ctx.fillStyle = PALETTE.lightGray;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', width / 2, 100);
      return;
    }

    if (error) {
      ctx.fillStyle = PALETTE.red;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(error, width / 2, 100);
    }

    // Header row
    let y = 38;
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '6px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Rank', 4, y);
    ctx.fillText('Player', 30, y);
    ctx.textAlign = 'right';
    ctx.fillText('Rating', 170, y);
    ctx.fillText('Tier', 200, y);
    ctx.fillText('Win%', 246, y);
    y += 10;

    for (let i = 0; i < Math.min(entries.length, 16); i++) {
      const entry = entries[i];
      ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)';
      ctx.fillRect(2, y - 6, 252, 10);
      ctx.fillStyle = entry.rank <= 3 ? PALETTE.gold : PALETTE.white;
      ctx.font = '6px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${entry.rank}`, 4, y + 2);
      ctx.fillText(`${entry.nickname}#${entry.tag}`, 30, y + 2);
      ctx.textAlign = 'right';
      ctx.fillText(`${entry.rating}`, 170, y + 2);
      ctx.fillText(entry.tier, 200, y + 2);
      ctx.fillText(`${Math.round(entry.winrate * 100)}%`, 246, y + 2);
      y += 10;
    }

    // Back button
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(4, 206, 40, 14);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Back', 24, 216);
  },
  exit() {
    /* nothing */
  },
};
