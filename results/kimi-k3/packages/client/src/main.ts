import { GameMode, MatchConfigDto } from '@splash/shared';
import { net } from './net.js';
import { audio } from './audio.js';
import { renderTitle } from './screens/title.js';
import { renderMenu } from './screens/menu.js';
import { renderBrowser, cleanup as browserCleanup } from './screens/browser.js';
import { renderLobby, cleanup as lobbyCleanup } from './screens/lobby.js';
import { renderQueue, cleanup as queueCleanup } from './screens/queue.js';
import { GameScreen, clearMatchConfig, storeMatchConfig } from './screens/game.js';
import { renderResults, cleanup as resultsCleanup } from './screens/results.js';
import { renderLeaderboard } from './screens/leaderboard.js';
import { renderLocker, cleanup as lockerCleanup } from './screens/locker.js';
import { renderSettings } from './screens/settings.js';
import { renderHowTo } from './screens/howtoplay.js';
import { renderTutorial } from './screens/tutorial.js';
import { ResultsData } from './render/hud.js';
import { clear, el, toast } from './screens/common.js';

type Go = (screen: string, data?: unknown) => void;

const app = document.getElementById('app')!;
let current = '';
let gameScreen: GameScreen | null = null;
let tutorialCleanup: (() => void) | null = null;
let pendingRoomCode: string | null = null;

const CLEANUPS: Record<string, (() => void)[]> = {
  browser: browserCleanup,
  lobby: lobbyCleanup,
  queue: queueCleanup,
  results: resultsCleanup,
  locker: lockerCleanup,
};

function runCleanups(name: string): void {
  const list = CLEANUPS[name];
  if (list) {
    list.forEach((f) => f());
    list.length = 0;
  }
}

const go: Go = (screen, data) => {
  if (current === screen && screen !== 'results') return;
  runCleanups(current);
  if (gameScreen && current === 'game') {
    gameScreen.stop();
    gameScreen = null;
  }
  if (tutorialCleanup) {
    tutorialCleanup();
    tutorialCleanup = null;
  }
  current = screen;
  clear(app);
  switch (screen) {
    case 'title':
      renderTitle(app, go);
      break;
    case 'menu':
      renderMenu(app, go);
      break;
    case 'browser':
      renderBrowser(app, go);
      break;
    case 'lobby':
      renderLobby(app, go, data as string | undefined);
      break;
    case 'queue':
      renderQueue(app, go, (data as GameMode) ?? 'duel');
      break;
    case 'game':
      if (!gameScreen) {
        gameScreen = new GameScreen({
          onMatchEnd: (results, rematchAllowed) => {
            go('results', { ...results, rematchAllowed });
          },
        });
        gameScreen.start();
      }
      break;
    case 'results': {
      const d = data as ResultsData & { rematchAllowed: boolean };
      renderResults(app, go, d);
      break;
    }
    case 'leaderboard':
      renderLeaderboard(app, go);
      break;
    case 'locker':
      renderLocker(app, go);
      break;
    case 'settings':
      renderSettings(app, go);
      break;
    case 'howto':
      renderHowTo(app, go);
      break;
    case 'tutorial':
      tutorialCleanup = renderTutorial(app, go);
      break;
    default:
      renderMenu(app, go);
  }
};

function boot(): void {
  clear(app);
  app.append(el('h1', { class: 'logo' }, ['SPLASH CRITTERS']), el('div', { class: 'dim' }, ['connecting...']));

  net.on('welcome', () => {
    const hash = location.hash;
    const m = /^#\/room\/([A-Z0-9]{6})$/i.exec(hash);
    if (m) {
      pendingRoomCode = m[1]!.toUpperCase();
      net.send({ t: 'join_room', code: pendingRoomCode });
      history.replaceState(null, '', location.pathname);
      go('lobby');
      return;
    }
    if (current === '' || current === 'title') go('title');
  });

  net.on('error', (msg) => toast(msg.msg));

  net.on('room_created', () => {
    go('lobby');
  });

  net.on('match_found', () => {
    go('game');
  });

  net.on('match_start', (msg) => {
    storeMatchConfig(msg.config as MatchConfigDto);
    if (gameScreen) {
      gameScreen.applyConfig(msg.config as MatchConfigDto);
    } else {
      go('game');
    }
  });

  net.on('match_end', () => {
    clearMatchConfig();
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.key === 'm' || e.key === 'M') && current !== 'game') {
        audio.ensure();
      }
    },
    { once: true },
  );
  document.addEventListener('click', () => audio.ensure(), { once: true });

  net.connect();
  go('title');
}

boot();
