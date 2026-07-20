import './style.css';
import { audio } from './audio';
import { input } from './input';
import { net } from './net';
import { nav, type ScreenInstance, type ScreenMount } from './router';
import { store, type ScreenName } from './store';
import { h, toast } from './ui';
import { VH, VW } from './render/pixel';

import { mount as browser } from './screens/browser';
import { mount as game } from './screens/game';
import { mount as howto } from './screens/howto';
import { mount as leaderboard } from './screens/leaderboard';
import { mount as lobby } from './screens/lobby';
import { mount as locker } from './screens/locker';
import { mount as menu } from './screens/menu';
import { mount as queue } from './screens/queue';
import { mount as results } from './screens/results';
import { mount as settings } from './screens/settings';
import { mount as title } from './screens/title';
import { mount as tutorial } from './screens/tutorial';

const bootScreen: ScreenMount = (root) => {
  const el = h('div', { class: 'screen panel narrow', style: 'text-align:center' }, [
    h('div', { class: 'title big', text: '💦' }),
    h('div', { class: 'subtitle', text: 'Connecting to the splash zone…' }),
  ]);
  root.append(el);
  return { unmount: () => el.remove() };
};

const REGISTRY: Record<ScreenName, ScreenMount> = {
  boot: bootScreen,
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

const overlay = document.getElementById('overlay') as HTMLElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
let current: ScreenInstance | null = null;

function go(name: ScreenName): void {
  if (current) current.unmount();
  overlay.replaceChildren();
  store.screen = name;
  canvas.classList.toggle('show', name === 'game');
  current = REGISTRY[name](overlay);
}
nav.go = go;

function resize(): void {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VW, window.innerHeight / VH)));
  canvas.style.width = `${VW * scale}px`;
  canvas.style.height = `${VH * scale}px`;
}

function boot(): void {
  resize();
  window.addEventListener('resize', resize);

  audio.setVolumes(store.settings.sfx, store.settings.music, store.settings.muted);
  input.start();
  input.onMute = () => audio.setVolumes(store.settings.sfx, store.settings.music, store.settings.muted);

  const unlock = (): void => audio.resume();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  net.navigate = go;
  net.toast = toast;

  // deep link: /#/room/CODE
  const m = /#\/room\/([A-Za-z0-9]+)/.exec(location.hash);
  let pendingRoom = m ? m[1].toUpperCase() : null;
  store.subscribe(() => {
    if (pendingRoom && store.profile && store.screen !== 'lobby' && store.screen !== 'game') {
      net.send({ type: 'join_room', code: pendingRoom });
      pendingRoom = null;
    }
  });

  net.connect();
  go('boot');

  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(100, now - last);
    last = now;
    current?.onFrame?.(dt, now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
