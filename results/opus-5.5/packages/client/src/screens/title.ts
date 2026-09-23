// Title screen: animated beach scene + shimmering logo on the canvas, blinking PRESS START.
// Start (Enter / Space / click) waits for the session, then offers the tutorial to players who
// have not done it yet ("Skip" tells the server) or goes straight to the main menu.
import type { Profile } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { PAL } from '../render/palette';
import { store } from '../store';
import { h, isTypingTarget, modal, pixelTitle, spinner } from '../ui';
import type { Screen } from './index';
import { installArrowNav } from './parts/arrowNav';
import { Scope } from './parts/scope';
import { runTitleScene } from './parts/titleScene';
import './parts/styles/base.css';
import './parts/styles/title.css';

let scope: Scope | null = null;
let started = false;

function isModalOpen(): boolean {
  return document.querySelector('.layer-modals .modal') !== null;
}

function offerTutorial(profile: Profile): void {
  const body = h(
    'div',
    { class: 'col center title-offer' },
    h('p', null, `Hi ${profile.nickname}!`),
    h('p', { class: 'muted-note' }, 'New here? A quick scripted match teaches moving, balloons, power-ups and chain splashes.'),
  );
  modal({
    title: 'Welcome to the beach',
    body,
    onClose: () => (started = false),
    actions: [
      { label: 'Play the tutorial (under 2 min)', variant: 'primary', onClick: () => navigate('/tutorial') },
      {
        label: 'Skip',
        variant: 'ghost',
        onClick: () => {
          net.send({ type: 'tutorial_skip' });
          navigate('/menu');
        },
      },
    ],
  });
}

function proceed(profile: Profile): void {
  if (profile.tutorialDone) navigate('/menu');
  else offerTutorial(profile);
}

interface Prompt {
  el: HTMLElement;
  showPress(): void;
  showConnecting(): void;
}

function buildPrompt(): Prompt {
  const press = [
    h('div', { class: 'blink' }, pixelTitle('PRESS START', 2, { color: PAL.yellow, shadow: PAL.orangeDark })),
    h('div', { class: 'title-hint' }, 'Enter / Space / Click'),
  ];
  const el = h('div', { class: 'title-prompt' }, press);
  return {
    el,
    showPress: () => el.replaceChildren(...press),
    showConnecting: () => el.replaceChildren(h('div', { class: 'title-hint' }, spinner('Connecting'))),
  };
}

/** Wait for the welcome (profile) before leaving the title, showing a connecting line meanwhile. */
function whenReady(prompt: Prompt, s: Scope, then: (p: Profile) => void): void {
  const ready = () => {
    const { connected, profile } = store.get();
    return connected && profile ? profile : null;
  };
  const now = ready();
  if (now) {
    then(now);
    return;
  }
  prompt.showConnecting();
  const unsub = store.subscribe(() => {
    const p = ready();
    if (!p) return;
    unsub();
    prompt.showPress();
    then(p);
  });
  s.add(unsub);
}

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    started = false;
    audio.music('title');
    runTitleScene(s);
    const prompt = buildPrompt();
    root.append(h('div', { class: 'title-screen screen-fill' }, prompt.el));

    const start = () => {
      if (started || isModalOpen()) return;
      started = true;
      audio.sfx('ui_select');
      whenReady(prompt, s, proceed);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target) || isModalOpen()) return;
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
      e.preventDefault();
      start();
    };
    window.addEventListener('keydown', onKey);
    s.add(() => window.removeEventListener('keydown', onKey));
    root.addEventListener('click', start);
    s.add(installArrowNav(root));
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
