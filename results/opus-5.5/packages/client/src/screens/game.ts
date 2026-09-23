// Match screen: the canvas game view (HUD, arena, overlays all drawn on the canvas), Esc for a
// leave-match confirm (ranked warns about the forfeit), and the hand-off to the results screen
// a moment after the final round result. Reopening it for a finished match (browser Back from
// #/results) goes straight back to that match's results.
import { navigate } from '../app';
import { matchLiveness, type MatchLiveness } from '../game/liveness';
import { GameView } from '../game/view';
import { net } from '../net';
import { store } from '../store';
import { isTypingTarget, modal, type ModalHandle } from '../ui';
import type { Screen } from './index';
import { watchForfeit } from './parts/forfeitNotice';

/** Leave the screen if no match shows up this long after the connection is ready (stale #/game). */
const NO_MATCH_TIMEOUT_MS = 6000;

let view: GameView | null = null;
let confirm: ModalHandle | null = null;
let watchdog = 0;

function leaveMatch(): void {
  const match = store.get().match;
  // No results screen follows a ranked forfeit: say what it cost once the server settles it.
  if (net.send({ type: 'leave_room' }) && match?.ranked) watchForfeit(match);
  navigate('/menu');
}

function openLeaveConfirm(): void {
  const match = store.get().match;
  if (confirm || !match || !view) return;
  const ranked = match.ranked;
  view.session.inputBlocked = true;
  confirm = modal({
    title: ranked ? 'Forfeit match?' : 'Leave match?',
    body: ranked
      ? 'Leaving a ranked match counts as a forfeit: you lose the match and rating.'
      : match.practice
        ? 'Leave this practice match and return to the menu?'
        : 'A bot will take over your critter for the rest of the match.',
    actions: [
      { label: 'Keep playing', hotkey: 'Escape' },
      { label: ranked ? 'Forfeit' : 'Leave', variant: 'danger', onClick: leaveMatch },
    ],
    onClose: () => {
      confirm = null;
      if (view) view.session.inputBlocked = false;
    },
  });
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.code !== 'Escape' || e.repeat || e.defaultPrevented || isTypingTarget(e.target)) return;
  if (liveness() !== 'live') return;
  e.preventDefault();
  openLeaveConfirm();
}

function liveness(): MatchLiveness {
  const { match, matchEnd } = store.get();
  return matchLiveness(match, matchEnd);
}

/** Back to the menu if no live match turns up (a stale #/game URL after a reload). */
function armWatchdog(): void {
  const since = Date.now();
  watchdog = window.setInterval(() => {
    if (liveness() === 'live') {
      window.clearInterval(watchdog);
      watchdog = 0;
      return;
    }
    if (store.get().connected && Date.now() - since > NO_MATCH_TIMEOUT_MS) navigate('/menu', { replace: true });
  }, 500);
}

export const screen: Screen = {
  mount(root) {
    if (liveness() === 'ended') {
      navigate(store.get().matchEnd?.tutorial ? '/menu' : '/results', { replace: true });
      return;
    }
    root.classList.add('game-overlay');
    view = new GameView({ music: 'battle', onMatchOver: () => navigate('/results') });
    view.mount();
    window.addEventListener('keydown', onKeyDown);
    armWatchdog();
  },
  unmount() {
    window.removeEventListener('keydown', onKeyDown);
    window.clearInterval(watchdog);
    watchdog = 0;
    confirm?.close();
    confirm = null;
    view?.unmount();
    view = null;
  },
};
