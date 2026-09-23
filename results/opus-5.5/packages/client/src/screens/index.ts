// Screen contract + registry. app.ts mounts exactly one screen at a time into a fresh root
// element inside frame.ui, and unmounts it (then discards the root) on every route change.
import { screen as title } from './title';
import { screen as tutorial } from './tutorial';
import { screen as menu } from './menu';
import { screen as browser } from './browser';
import { screen as lobby } from './lobby';
import { screen as queue } from './queue';
import { screen as game } from './game';
import { screen as results } from './results';
import { screen as leaderboard } from './leaderboard';
import { screen as locker } from './locker';
import { screen as settings } from './settings';
import { screen as howto } from './howto';

export interface Screen {
  /**
   * Build the screen inside `root` (an empty element covering the 256x224 overlay).
   * `params` holds route parameters: lobby gets { code } for #/room/CODE join links,
   * queue gets { mode } ('duel' | 'ffa').
   */
  mount(root: HTMLElement, params: Record<string, string>): void;
  /** Release timers, subscriptions and canvas loops. The root element is removed by app.ts. */
  unmount(): void;
}

export type ScreenName =
  | 'title'
  | 'tutorial'
  | 'menu'
  | 'browser'
  | 'lobby'
  | 'queue'
  | 'game'
  | 'results'
  | 'leaderboard'
  | 'locker'
  | 'settings'
  | 'howto';

export const screens: Record<ScreenName, Screen> = {
  title,
  tutorial,
  menu,
  browser,
  lobby,
  queue,
  game,
  results,
  leaderboard,
  locker,
  settings,
  howto,
};
