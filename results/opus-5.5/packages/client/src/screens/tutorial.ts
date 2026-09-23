// Tutorial screen: the same canvas game view as a match, driven by the server's scripted
// TutorialController. An objectives panel follows store.tutorialStep (step x/5, title, text);
// Skip (or Esc) abandons it; completion shows the XP award from the tutorial's match_end.
import type { MatchEndMsg } from '@splash/shared';
import { navigate } from '../app';
import { GameView } from '../game/view';
import { net } from '../net';
import { store, type AppState } from '../store';
import { button, h, modal, type ModalHandle } from '../ui';
import type { Screen } from './index';

/** If the XP award has not arrived this long after the last step, show the card without it. */
const XP_WAIT_MS = 1500;
/** Give up waiting for the XP line on the card after this long (the award is saved server-side). */
const XP_GIVE_UP_MS = 5000;

interface Panel {
  root: HTMLElement;
  step: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
}

let view: GameView | null = null;
let panel: Panel | null = null;
let doneCard: { handle: ModalHandle; xp: HTMLElement; detail: HTMLElement } | null = null;
let unsubscribe: (() => void) | null = null;
let started = false;
let doneTimer = 0;

function buildPanel(): Panel {
  const step = h('span', { class: 'tutorial-step' }, 'STEP 1/5');
  const title = h('span', { class: 'tutorial-title' }, 'Getting ready');
  const text = h('p', { class: 'tutorial-text' }, 'Loading the practice arena.');
  const skip = button('Skip', skipTutorial, { small: true, variant: 'ghost', hotkey: 'Escape', title: 'Skip the tutorial' });
  const root = h('div', { class: 'tutorial-panel' }, h('div', { class: 'tutorial-copy' }, h('div', { class: 'tutorial-head' }, step, title), text), skip);
  return { root, step, title, text };
}

function skipTutorial(): void {
  net.send({ type: 'tutorial_skip' });
  navigate('/menu');
}

function finish(): void {
  net.send({ type: 'leave_room' });
  navigate('/menu');
}

/** XP line for the local player from the tutorial's match_end (null until it arrives). */
function xpText(end: MatchEndMsg | null): { xp: string; detail: string } | null {
  if (!end || !end.tutorial) return null;
  const mine = end.xp.find((x) => x.playerId === net.playerId) ?? end.xp[0];
  if (!mine || mine.earned <= 0) return { xp: '+0 XP', detail: 'Tutorial XP is only awarded the first time.' };
  const level = mine.levelAfter > mine.levelBefore ? `Level up! You reached level ${mine.levelAfter}.` : `Level ${mine.levelAfter}`;
  return { xp: `+${mine.earned} XP`, detail: level };
}

function showDoneCard(): void {
  if (doneCard) return;
  window.clearTimeout(doneTimer);
  if (view) view.session.inputBlocked = true;
  const xp = h('div', { class: 'tutorial-xp' }, '...');
  const detail = h('p', { class: 'muted small' }, 'Adding up your XP');
  const body = h('div', { class: 'tutorial-done' }, h('p', {}, 'You are ready to splash!'), xp, detail);
  const handle = modal({ title: 'Tutorial complete!', body, dismissible: false, actions: [{ label: 'Continue', variant: 'primary', hotkey: 'Enter', onClick: finish }] });
  doneCard = { handle, xp, detail };
  renderDoneCard(store.get().matchEnd);
  doneTimer = window.setTimeout(() => {
    if (!doneCard || xpText(store.get().matchEnd)) return;
    doneCard.xp.textContent = '';
    doneCard.detail.textContent = 'Your XP is saved to your profile.';
  }, XP_GIVE_UP_MS);
}

function renderDoneCard(end: MatchEndMsg | null): void {
  const text = xpText(end);
  if (!doneCard || !text) return;
  doneCard.xp.textContent = text.xp;
  doneCard.detail.textContent = text.detail;
}

function renderStep(state: Readonly<AppState>): void {
  const step = state.tutorialStep;
  if (!panel || !step) return;
  panel.step.textContent = `STEP ${Math.min(step.step, step.total)}/${step.total}`;
  panel.title.textContent = step.title;
  panel.text.textContent = step.text;
  if (step.done && !doneCard && !doneTimer) {
    doneTimer = window.setTimeout(showDoneCard, state.matchEnd?.tutorial ? 0 : XP_WAIT_MS);
  }
}

function onStore(next: Readonly<AppState>, prev: Readonly<AppState>): void {
  if (next.connected && !started) begin();
  if (next.tutorialStep !== prev.tutorialStep) renderStep(next);
  if (next.matchEnd !== prev.matchEnd && next.matchEnd?.tutorial) {
    if (doneCard) renderDoneCard(next.matchEnd);
    else if (next.tutorialStep?.done) showDoneCard();
  }
}

/** Ask the server for the scripted tutorial once connected (a re-attached one keeps running). */
function begin(): void {
  started = true;
  const { match, matchEnd } = store.get();
  if (match?.tutorial && !matchEnd) return;
  net.send({ type: 'tutorial_start' });
}

export const screen: Screen = {
  mount(root) {
    root.classList.add('game-overlay');
    started = false;
    store.update({ tutorialStep: null });
    view = new GameView({ music: 'tutorial', onMatchOver: showDoneCard });
    view.mount();
    panel = buildPanel();
    root.append(panel.root);
    unsubscribe = store.subscribe(onStore);
    if (store.get().connected) begin();
  },
  unmount() {
    window.clearTimeout(doneTimer);
    doneTimer = 0;
    unsubscribe?.();
    unsubscribe = null;
    doneCard?.handle.close();
    doneCard = null;
    view?.unmount();
    view = null;
    panel = null;
  },
};
