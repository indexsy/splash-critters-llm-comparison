/**
 * The screen registry. Each module exports a factory returning a Screen; the
 * router owns their lifecycle.
 */

import type { RouteDef, ScreenFactory } from '../router';
import { createTitleScreen } from './title';
import { createMenuScreen } from './menu';
import { createTutorialScreen } from './tutorial';
import { createBrowserScreen } from './browser';
import { createCreateRoomScreen } from './create';
import { createLobbyScreen } from './lobby';
import { createQueueScreen } from './queue';
import { createGameScreen } from './game';
import { createResultsScreen } from './results';
import { createLeaderboardScreen } from './leaderboard';
import { createLockerScreen } from './locker';
import { createSettingsScreen } from './settings';
import { createHowToScreen } from './howto';

export const ROUTES: RouteDef[] = [
  { path: '/', factory: createTitleScreen },
  { path: '/menu', factory: createMenuScreen },
  { path: '/tutorial', factory: createTutorialScreen },
  { path: '/browse', factory: createBrowserScreen },
  { path: '/create', factory: createCreateRoomScreen },
  { path: '/room/:code', factory: createLobbyScreen },
  { path: '/queue/:mode', factory: createQueueScreen },
  { path: '/game', factory: createGameScreen },
  { path: '/results', factory: createResultsScreen },
  { path: '/leaderboard', factory: createLeaderboardScreen },
  { path: '/locker', factory: createLockerScreen },
  { path: '/settings', factory: createSettingsScreen },
  { path: '/howto', factory: createHowToScreen },
];

export const NOT_FOUND: ScreenFactory = createTitleScreen;
