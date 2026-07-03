import type { Screen } from './types.js';
import { screenManager, audioEngine } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import { clientState } from './title.js';

interface MenuItem {
  label: string;
  icon: string;
  action: () => void;
}

const menuItems: MenuItem[] = [
  { label: 'Ranked Duel', icon: '⚔', action: () => screenManager.switchTo('queue', { mode: 'duel' }) },
  { label: 'Ranked FFA', icon: '👑', action: () => screenManager.switchTo('queue', { mode: 'ffa' }) },
  { label: 'Casual Rooms', icon: '🌐', action: () => screenManager.switchTo('browser') },
  { label: 'Practice Bots', icon: '🤖', action: () => screenManager.switchTo('lobby', { practice: true }) },
  { label: 'Leaderboard', icon: '🏆', action: () => screenManager.switchTo('leaderboard') },
  { label: 'Locker', icon: '🎒', action: () => screenManager.switchTo('locker') },
  { label: 'How to Play', icon: '❓', action: () => screenManager.switchTo('tutorial') },
  { label: 'Settings', icon: '⚙', action: () => screenManager.switchTo('settings') },
];

export const menuScreen: Screen = {
  enter(_data?: unknown) {
    audioEngine.playMusic('menu');
  },
  update(_dt: number) {
    /* nothing */
  },
  render(ctx: CanvasRenderingContext2D) {
    const tick = Date.now() / 1000;
    const width = 256;

    // Dark background
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    // Animated background critters
    for (let i = 0; i < 8; i++) {
      const x = ((i * 30 + tick * 20) % (width + 20)) - 10;
      const y = 30 + (i % 3) * 60 + Math.sin(tick + i) * 5;
      const walkFrame = Math.floor(tick * 4 + i) % 2;
      const dir = i % 2 === 0 ? 'right' : 'left';
      const ax = dir === 'right' ? x : width - x;
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(ax, y, 8, 8);
      ctx.fillStyle = PALETTE.teal;
      ctx.fillRect(ax + 2, y + 4, 4, 2);
      ctx.fillStyle = PALETTE.black;
      ctx.fillRect(ax + 2, y + 1, 1, 1);
      ctx.fillRect(ax + 5, y + 1, 1, 1);
      if (walkFrame === 1) {
        ctx.fillStyle = PALETTE.green;
        ctx.fillRect(ax + 1, y + 7, 2, 1);
        ctx.fillRect(ax + 5, y + 7, 2, 1);
      }
    }

    // Player info at top
    const profile = clientState.profile;
    if (profile) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(4, 4, 248, 22);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${profile.nickname}`, 10, 14);
      ctx.fillStyle = PALETTE.yellow;
      ctx.textAlign = 'right';
      ctx.fillText(`Lv.${profile.level}  XP:${profile.xp}`, 246, 14);
      // XP bar
      const xpForLevel = 100 + 25 * profile.level;
      const xpPct = Math.min(1, profile.xp / xpForLevel);
      ctx.fillStyle = PALETTE.darkGray;
      ctx.fillRect(10, 18, 100, 4);
      ctx.fillStyle = PALETTE.yellow;
      ctx.fillRect(10, 18, 100 * xpPct, 4);
    }

    // Menu items
    const startY = 36;
    const itemH = 22;
    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      const y = startY + i * itemH;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(40, y, 176, 18);
      ctx.fillStyle = PALETTE.white;
      ctx.strokeStyle = PALETTE.lightGray;
      ctx.lineWidth = 1;
      ctx.strokeRect(40, y, 176, 18);
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${item.icon} ${item.label}`, 48, y + 10);
    }

    // Title
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPLASH CRITTERS', width / 2, 220);
  },
  exit() {
    /* nothing */
  },
};
