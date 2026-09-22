import type { ServerMsg } from '@splash/shared';
import { AudioEngine } from './audio.js';
import type { App } from './app.js';
import { Net } from './net.js';
import { loadSettings, saveSettings } from './settings.js';
import { mountBrowser } from './screens/browser.js';
import { mountGame } from './screens/game.js';
import { mountHowto } from './screens/howto.js';
import { mountLeaderboard } from './screens/leaderboard.js';
import { mountLobby } from './screens/lobby.js';
import { mountLocker } from './screens/locker.js';
import { mountMenu } from './screens/menu.js';
import { mountQueue } from './screens/queue.js';
import { mountResults } from './screens/results.js';
import { mountSettings } from './screens/settings.js';
import { mountTitle } from './screens/title.js';
import { mountTutorial } from './screens/tutorial.js';
import './styles.css';

const root = document.querySelector('#app') as HTMLElement;
const settings = loadSettings();
const net = new Net();
const audio = new AudioEngine(settings);
let current = '';
let unmount = () => {};
let toastTimer = 0;

const app: App = {
  net,
  audio,
  settings,
  profile: null,
  session: { matchStart: null, matchEnd: null, lobby: null, queue: null },
  goto(name: string) {
    if (name === current) return;
    current = name;
    unmount();
    audio.setScreen(name === 'game' ? 'game' : name === 'results' ? 'results' : 'menu');
    const screens: Record<string, (root: HTMLElement, app: App) => () => void> = {
      title: mountTitle,
      menu: mountMenu,
      tutorial: mountTutorial,
      browser: mountBrowser,
      create: mountBrowser,
      lobby: mountLobby,
      queue: mountQueue,
      game: mountGame,
      results: mountResults,
      leaderboard: mountLeaderboard,
      locker: mountLocker,
      settings: mountSettings,
      howto: mountHowto,
    };
    unmount = (screens[name] ?? mountMenu)(root, app);
    if (name === 'menu' || name === 'title') history.replaceState(null, '', `#/${name === 'title' ? '' : name}`);
  },
  toast(msg: string) {
    let el = document.querySelector('.toast') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el?.remove(), 2400);
  },
  saveSettings() {
    saveSettings(settings);
    audio.settings = settings;
  },
};

net.on((msg: ServerMsg) => {
  if (msg.t === 'welcome' || msg.t === 'profile') app.profile = msg.profile;
  if (msg.t === 'error') app.toast(msg.msg);
  if (msg.t === 'lobby_state') {
    app.session.lobby = msg;
    if (current !== 'game' && current !== 'results' && current !== 'lobby') app.goto('lobby');
  }
  if (msg.t === 'room_created') app.goto('lobby');
  if (msg.t === 'queue_status') {
    app.session.queue = msg;
    if (current !== 'queue') app.goto('queue');
  }
  if (msg.t === 'match_found') app.toast('Match found');
  if (msg.t === 'match_start') {
    app.session.matchStart = msg;
    app.session.matchEnd = null;
    app.goto('game');
  }
  if (msg.t === 'match_end') {
    app.session.matchEnd = msg;
    app.goto('results');
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'KeyM') {
    audio.toggleMute();
    settings.mute = audio.settings.mute;
    saveSettings(settings);
    app.toast(settings.mute ? 'Muted' : 'Sound on');
  }
});

const hash = location.hash.replace(/^#\/?/, '');
const pendingRoom = hash.startsWith('room/') ? hash.split('/')[1]?.toUpperCase() : '';
net.connect();
app.goto('title');
if (pendingRoom) {
  const off = net.on((msg) => {
    if (msg.t === 'welcome') {
      off();
      net.send({ t: 'join_room', code: pendingRoom });
    }
  });
}
