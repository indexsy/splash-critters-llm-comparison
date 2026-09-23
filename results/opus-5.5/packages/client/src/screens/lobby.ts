// Casual / practice room lobby. Renders store.lobby live (room info, the shareable code with
// Copy Link, slot cards, host slot controls, READY / START). Entered via #/room/CODE it shows a
// "joining" card until the server answers (leaving it earlier abandons the join); the app moves
// on to the match at match_start.
import type { LobbyState } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { measureText } from '../render/font';
import { store } from '../store';
import { button, h, spinner, toast } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { abandonRoomJoin, isAbandonedJoin } from './parts/joinCancel';
import { mySlot } from './parts/lobbyRules';
import { lobbyBody, type LobbyActions } from './parts/lobbyView';
import { rerender } from './parts/refocus';
import { Scope } from './parts/scope';
import { screenShell, setShellTitle } from './parts/shell';
import './parts/styles/lobby.css';

/** Wait this long for left_room before leaving the screen on our own. */
const LEAVE_FALLBACK_MS = 1500;
const TITLE_MAX_PX = 150;

let scope: Scope | null = null;

const actions: LobbyActions = {
  toggleReady() {
    const lobby = store.get().lobby;
    const me = lobby ? mySlot(lobby) : undefined;
    if (!me) return;
    if (!net.send({ type: 'set_ready', ready: !me.ready })) toast('Not connected. Try again in a moment.', 'error');
  },
  start() {
    if (!net.send({ type: 'start_match' })) toast('Not connected. Try again in a moment.', 'error');
  },
};

function leaveRoom(s: Scope): void {
  if (!store.get().lobby) {
    navigate('/menu');
    return;
  }
  if (!net.send({ type: 'leave_room' })) {
    toast('Not connected. Try again in a moment.', 'error');
    return;
  }
  s.timeout(() => navigate('/menu'), LEAVE_FALLBACK_MS);
}

function titleScale(name: string): number {
  return measureText(name.toUpperCase(), 'big') * 2 <= TITLE_MAX_PX ? 2 : 1;
}

function joiningCard(code: string): HTMLElement {
  return h(
    'div',
    { class: 'lobby-joining' },
    spinner(`Joining room ${code}`),
    h('p', { class: 'muted-note' }, 'Hang tight while the host lets you in.'),
    button('Cancel', () => navigate('/menu', { replace: true }), { variant: 'ghost', hotkey: 'Escape' }),
  );
}

/**
 * Wait on the room link's join: a lobby moves on to #/lobby, an error is the app's to handle,
 * and leaving before either (Cancel, browser Back) abandons the join still in flight.
 */
function awaitJoin(root: HTMLElement, s: Scope, code: string): void {
  root.append(joiningCard(code));
  let settled = false;
  s.add(
    store.subscribe((next, prev) => {
      if (next.lastError !== prev.lastError) settled = true;
      // The app routes lobby-phase rooms itself; any other phase would otherwise leave us here.
      if (next.lobby) {
        settled = true;
        navigate('/lobby', { replace: true });
      }
    }),
  );
  s.add(() => {
    if (!settled && !store.get().lobby) abandonRoomJoin(code);
  });
}

/** Focus START / READY when usable, else the harmless Copy Link (never LEAVE by accident). */
function focusDefault(root: HTMLElement): void {
  if (root.querySelector('[data-autofocus]')) focusInitial(root);
  else root.querySelector<HTMLElement>('[data-nav-key="copy"]')?.focus({ preventScroll: true });
}

function mountLobby(root: HTMLElement, s: Scope, lobby: LobbyState): void {
  const body = h('div', { class: 'lobby-body' });
  const shell = screenShell(
    { title: lobby.name, titleScale: titleScale(lobby.name), onBack: () => leaveRoom(s), backLabel: 'Leave', className: 'lobby' },
    body,
  );
  root.append(shell);
  const render = (next: LobbyState) => rerender(body, () => lobbyBody(next, actions));
  render(lobby);
  s.add(
    store.subscribe((next, prev) => {
      if (!next.lobby || next.lobby === prev.lobby) return;
      if (next.lobby.name !== prev.lobby?.name) setShellTitle(shell, next.lobby.name, titleScale(next.lobby.name));
      render(next.lobby);
    }),
  );
  focusDefault(root);
}

export const screen: Screen = {
  mount(root, params) {
    const lobby = store.get().lobby;
    // A join the player walked away from was accepted after all: the leave is already on its way.
    if (lobby && isAbandonedJoin(lobby.code)) {
      navigate('/menu', { replace: true });
      return;
    }
    const s = new Scope();
    scope = s;
    audio.music('lobby');
    runMenuBackdrop(s);
    s.add(installArrowNav(root));
    if (lobby) {
      mountLobby(root, s, lobby);
      return;
    }
    if (params.code) {
      awaitJoin(root, s, params.code);
      return;
    }
    navigate('/menu', { replace: true });
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
