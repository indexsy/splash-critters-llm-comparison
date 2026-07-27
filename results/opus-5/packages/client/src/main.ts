/**
 * Boot: open the socket, wire the routes, and run one animation loop that the
 * active screen can hook into. Navigation that must happen no matter which
 * screen is mounted (a match starting, a match ending) lives here.
 */

import './style.css';
import { initAudio } from './audio';
import { connect, on } from './net';
import { activeScreen, currentPath, defineRoutes, navigate, startRouter } from './router';
import { NOT_FOUND, ROUTES } from './screens/index';
import { getState, setState, subscribe } from './store';
import { requestFit, showStage, tickStageFit } from './stage';
import { el } from './ui/dom';

const MAX_FRAME_MS = 100;

function mountToasts(): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  let lastIds = '';
  subscribe((state) => {
    const ids = state.toasts.map((t) => t.id).join(',');
    if (ids === lastIds) return;
    lastIds = ids;
    host.replaceChildren(
      ...state.toasts.map((toast) =>
        el('div', { class: `toast toast-${toast.kind}`, text: toast.msg }),
      ),
    );
  });
}

/**
 * Screens that create a room and play a match without leaving their own route.
 * The tutorial is one: it drives room_created, lobby_state and match_start from
 * a single screen, so following the server around would unmount it mid-lesson.
 * State still lands in the store either way; only the navigation is suppressed.
 */
const SELF_DRIVEN_ROUTES = new Set(['/tutorial']);

function serverMayNavigate(): boolean {
  return !SELF_DRIVEN_ROUTES.has(currentPath());
}

/** Navigation triggered by the server rather than by a click. */
function wireGlobalNavigation(): void {
  on('room_created', (msg) => {
    if (serverMayNavigate()) navigate(`/room/${msg.code}`);
  });
  on('match_found', (msg) => {
    if (serverMayNavigate()) navigate(`/room/${msg.code}`);
  });

  on('match_start', (msg) => {
    setState({ match: msg.config, matchEnd: null, rematch: null });
    if (serverMayNavigate()) navigate('/game');
  });

  on('match_end', (msg) => {
    setState({ matchEnd: msg });
    if (serverMayNavigate()) navigate('/results');
  });

  on('lobby_state', (msg) => {
    setState({ lobby: msg.lobby });
    if (!serverMayNavigate()) return;
    const path = currentPath();
    const roomPath = `/room/${msg.lobby.code}`;
    // Follow the room while it is in the lobby, but never yank a player out of
    // a live match or the results screen.
    if (msg.lobby.phase === 'lobby' && path !== roomPath && path !== '/game' && path !== '/results') {
      navigate(roomPath);
    }
  });

  on('queue_status', (msg) => setState({ queue: msg }));
  on('room_list', (msg) => setState({ rooms: msg.rooms }));
  on('rematch_state', (msg) => setState({ rematch: msg }));

  on('welcome', () => {
    if (currentPath() === '/') return;
    // A reconnect mid-session should land back on the title rather than a stale
    // room screen that no longer exists.
    if (!getState().match) navigate('/');
  });
}

/**
 * Browsers refuse to start an AudioContext outside a gesture, and a session can
 * reach any screen without ever touching the title (a refresh while seated in a
 * room bounces through it before a click can land). Binding the unlock once, at
 * the document level, means the first gesture anywhere brings sound up and
 * releases any track a screen asked for in the meantime.
 */
function bindAudioUnlock(): void {
  const unlock = (): void => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    initAudio();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function startFrameLoop(): void {
  let last = performance.now();
  const step = (now: number): void => {
    const dt = Math.min(MAX_FRAME_MS, now - last);
    last = now;
    tickStageFit();
    activeScreen()?.frame?.(dt);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function boot(): void {
  const host = document.getElementById('screen');
  if (!host) throw new Error('#screen mount point is missing');

  showStage(false);
  window.addEventListener('resize', requestFit);
  // Every screen swaps the DOM under the canvas, so the fit has to be redone.
  window.addEventListener('hashchange', requestFit);

  mountToasts();
  bindAudioUnlock();
  wireGlobalNavigation();
  connect();

  defineRoutes(ROUTES, NOT_FOUND);
  startRouter(host);
  startFrameLoop();
}

boot();
