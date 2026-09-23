// Ranked queue: mode title, a pacing critter, elapsed time ticking locally, the widening search
// range, ETA and players in queue, and Cancel (queue_leave). On match_found it plays the jingle
// and flashes MATCH FOUND! with the opponents; the app switches to the match (whose VS intro
// card shows the same roster) a moment after match_start, so the flash stays readable even
// though the server sends match_start in the same tick as match_found.
import type { Mode } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { store } from '../store';
import { button, h, spinner, toast } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { modeLabel } from './parts/format';
import { matchFoundView } from './parts/matchFound';
import { queueStats } from './parts/queueStats';
import { runQueueCritter, QUEUE_SCENE_H, QUEUE_SCENE_W } from './parts/queueCritter';
import { followQueue, leaveRoomFirstText, rankedEntry, searchingMode } from './parts/queueRules';
import { sendQueueJoin, takeQueueRequest } from './parts/ranked';
import { Scope } from './parts/scope';
import { screenShell } from './parts/shell';
import { pixelCanvas } from './parts/sprite';
import './parts/styles/queue.css';

let scope: Scope | null = null;

/** Make sure a queue_join for `mode` is (or will be) on its way; false = cannot queue now. */
function ensureQueued(mode: Mode, s: Scope): boolean {
  const state = store.get();
  if (searchingMode(state) === mode || takeQueueRequest(mode)) return true;
  const entry = rankedEntry(state, mode);
  if (entry.action === 'leave_room_first') {
    toast(leaveRoomFirstText(entry.code), 'warn');
    return false;
  }
  if (entry.action === 'pick_nickname') {
    toast('Pick a nickname on the main menu to play ranked', 'warn');
    return false;
  }
  if (state.connected) return sendQueueJoin(mode);
  const unsub = store.subscribe((next, prev) => {
    if (!next.connected || prev.connected) return;
    unsub();
    sendQueueJoin(mode);
  });
  s.add(unsub);
  return true;
}

function cancel(): void {
  net.send({ type: 'queue_leave' });
  navigate('/menu');
}

/**
 * Follow the server: to the other mode's screen when it holds us in that queue, to the menu when
 * it drops us from the queue or refuses the join. Once a match was found the app owns what
 * happens next (match_start, or its re-attach timeout).
 */
function followServerQueue(s: Scope, mode: Mode): void {
  let matched = store.get().matchFound !== null;
  s.add(
    store.subscribe((next, prev) => {
      matched ||= next.matchFound !== null || next.match !== null;
      if (matched) return;
      const follow = followQueue(next, prev, mode);
      if (follow.to === 'menu') navigate('/menu', { replace: true });
      else if (follow.to === 'queue') navigate(`/queue/${follow.mode}`, { replace: true });
    }),
  );
}

function searchingView(s: Scope, mode: Mode): HTMLElement {
  const profile = store.get().profile;
  const scene = pixelCanvas(QUEUE_SCENE_W, QUEUE_SCENE_H, 2, 'queue-scene');
  if (profile) runQueueCritter(scene, s, profile.animal, profile.hat);
  const cancelBtn = button('Cancel search', cancel, { variant: 'ghost', hotkey: 'Escape' });
  cancelBtn.dataset.autofocus = '';
  return h(
    'div',
    { class: 'queue-body' },
    h('div', { class: 'queue-heading' }, spinner(mode === 'duel' ? 'Searching for an opponent' : 'Searching for 3 opponents')),
    scene,
    queueStats(s, mode),
    cancelBtn,
  );
}

export const screen: Screen = {
  mount(root, params) {
    const s = new Scope();
    scope = s;
    const mode: Mode = params.mode === 'ffa' ? 'ffa' : 'duel';
    const searching = searchingMode(store.get());
    if (searching && searching !== mode) {
      // Already searching (or matched) in the other queue: show that search, never a phantom one.
      s.dispose();
      navigate(`/queue/${searching}`, { replace: true });
      return;
    }
    if (!ensureQueued(mode, s)) {
      s.dispose();
      navigate('/menu', { replace: true });
      return;
    }
    audio.music('lobby');
    runMenuBackdrop(s);
    const body = h('div', { class: 'queue-wrap' });
    root.append(screenShell({ title: `Ranked ${mode === 'duel' ? 'Duel' : 'FFA'}`, className: 'queue' }, body));
    root.querySelector('.shell-body')?.setAttribute('aria-label', `Ranked ${modeLabel(mode)} queue`);

    const showFound = () => {
      const found = store.get().matchFound;
      if (!found) return;
      audio.sfx('match_found');
      body.replaceChildren(matchFoundView(found));
    };
    if (store.get().matchFound) showFound();
    else body.append(searchingView(s, mode));
    s.add(
      store.subscribe((next, prev) => {
        if (next.matchFound && next.matchFound !== prev.matchFound) showFound();
      }),
    );
    followServerQueue(s, mode);
    s.add(installArrowNav(root));
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
