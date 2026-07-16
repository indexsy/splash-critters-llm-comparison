import type { Profile } from '@splash/shared';
import { tierFromRating } from '@splash/shared';
import { drawMenu, pixelBg, text, W, type MenuItem } from './common.js';

export const MENU_ITEMS: MenuItem[] = [
  { label: 'Play Ranked', action: 'ranked' },
  { label: 'Casual', action: 'casual' },
  { label: 'Practice vs Bots', action: 'practice' },
  { label: 'Leaderboard', action: 'leaderboard' },
  { label: 'Locker', action: 'locker' },
  { label: 'How to Play', action: 'howto' },
  { label: 'Settings', action: 'settings' },
];

export const RANKED_ITEMS: MenuItem[] = [
  { label: 'Duel (1v1)', action: 'queue_duel' },
  { label: 'Free-for-All (4p)', action: 'queue_ffa' },
  { label: 'Back', action: 'back' },
];

export const CASUAL_ITEMS: MenuItem[] = [
  { label: 'Browse Rooms', action: 'browser' },
  { label: 'Create Room', action: 'create' },
  { label: 'Join by Code', action: 'join' },
  { label: 'Back', action: 'back' },
];

export function drawMainMenu(
  ctx: CanvasRenderingContext2D,
  tick: number,
  selected: number,
  items: MenuItem[],
  title: string,
  profile: Profile | null,
): void {
  pixelBg(ctx, tick);
  drawMenu(ctx, title, items, selected, 55);
  if (profile) {
    text(ctx, `${profile.nickname}#${profile.tag}`, 8, 12, '#4fc3f7', 7);
    text(ctx, `Lv${profile.level}`, 8, 22, '#fff59d', 6);
    const duel = profile.ratings.duel;
    text(ctx, `Duel ${tierFromRating(duel.rating)} ${duel.rating}`, W - 8, 12, '#aaa', 6, 'right');
  }
}
