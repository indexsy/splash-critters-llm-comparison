import type { Difficulty, Mode } from '@splash/shared';
import { app, toast } from './app.js';
import { audio } from './audio.js';
import { net } from './net.js';
import { showBrowser, showCreate } from './screens/browser.js';
import { showGame } from './screens/game.js';
import { showHowto } from './screens/howto.js';
import { showLeaderboard } from './screens/leaderboard.js';
import { showLobby } from './screens/lobby.js';
import { showLocker } from './screens/locker.js';
import { showMenu } from './screens/menu.js';
import { showQueue } from './screens/queue.js';
import { showResults } from './screens/results.js';
import { showSettings } from './screens/settings.js';
import { showTitle } from './screens/title.js';
import { showDebug, showTutorial } from './screens/tutorial.js';

let cleanup: (() => void) | null = null;
let booted = false;
let practice: { mode: Mode; diff: Difficulty } | null = null;

function go(name: string, fn: () => (() => void) | void) {
  app.screen = name;
  cleanup?.();
  cleanup = fn() ?? null;
}

function menu() { go('menu', () => showMenu(nav)); }
function lobby() { go('lobby', () => showLobby({ back: menu })); }

const nav = {
  ranked(mode: Mode) {
    if (!app.profile?.nickSet) {
      toast('Set a nickname in Settings before ranked.');
      go('settings', () => showSettings({ back: menu }));
      return;
    }
    net.send({ t: 'queue_join', mode });
    go('queue', () => showQueue(mode, { cancel: menu }));
  },
  browser() { go('browser', () => showBrowser({ back: menu, create: nav.create })); },
  create() { go('create', () => showCreate({ back: menu })); },
  practice() {
    practice = { mode: 'ffa', diff: 'medium' };
    net.send({
      t: 'create_room',
      opts: { name: 'Practice', mode: 'ffa', public: false, theme: 'beach', roundsToWin: 3, botFill: true },
    });
    lobby();
  },
  leaderboard() { go('board', () => showLeaderboard({ back: menu })); },
  locker() { go('locker', () => showLocker({ back: menu })); },
  howto() { go('howto', () => showHowto({ back: menu, tutorial: () => go('tutorial', () => showTutorial({ done: menu })) })); },
  settings() { go('settings', () => showSettings({ back: menu })); },
  tutorial() { go('tutorial', () => showTutorial({ done: menu })); },
};

function afterTitle() {
  const seen = localStorage.getItem('splash_tutorial') === '1' || app.profile?.tutorialDone;
  if (!seen) go('tutorial', () => showTutorial({ done: menu }));
  else menu();
}

net.on((msg) => {
  if (msg.t === 'welcome' && !booted) {
    booted = true;
    audio.ensure();
    const hash = location.hash;
    if (hash === '#/debug') {
      go('debug', () => showDebug({ back: menu }));
      return;
    }
    if (hash.startsWith('#/room/')) {
      net.send({ t: 'join_room', code: decodeURIComponent(hash.slice(7)) });
      lobby();
      return;
    }
    setTimeout(() => {
      if (app.screen === 'game' || app.screen === 'lobby') return;
      go('title', () => showTitle(afterTitle));
    }, 40);
  }
  if (msg.t === 'room_created') {
    location.hash = `#/room/${msg.code}`;
    if (practice) {
      const diffs: Difficulty[] = practice.mode === 'duel' ? ['medium'] : ['medium', 'medium', 'hard'];
      diffs.forEach((d, i) => net.send({ t: 'set_slot', slot: i + 1, kind: 'bot', difficulty: d }));
      setTimeout(() => net.send({ t: 'start_match' }), 200);
      practice = null;
    }
    lobby();
  }
  if (msg.t === 'lobby_state' && (msg.room.phase === 'lobby' || msg.room.phase === 'intro')) {
    if (!location.hash.includes(msg.room.code)) location.hash = `#/room/${msg.room.code}`;
    if (!app.screen || app.screen === 'title') lobby();
  }
  if (msg.t === 'match_start') go('game', showGame);
  if (msg.t === 'match_end') go('results', () => showResults({ menu }));
});

document.addEventListener('click', () => audio.ensure(), { once: true });
net.connect();

window.addEventListener('hashchange', () => {
  const hash = location.hash;
  if (hash.startsWith('#/room/') && app.profile) {
    net.send({ t: 'join_room', code: decodeURIComponent(hash.slice(7)) });
    lobby();
  }
});
