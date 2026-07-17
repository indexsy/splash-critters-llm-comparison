import { el, showApp } from './common.js';
import { audio } from '../audio.js';

export function renderTitle(root: HTMLElement, go: (screen: string) => void): void {
  showApp();
  audio.playMusic('menu');
  const logo = el('h1', { class: 'logo' }, ['SPLASH CRITTERS']);
  const sub = el('div', { class: 'dim' }, ['8-bit water balloon battler']);
  const prompt = el('button', {}, ['PRESS TO PLAY']);
  prompt.onclick = () => {
    audio.ensure();
    go(net.profile && !net.profile.tutorialDone ? 'tutorial' : 'menu');
  };
  const bubbleBox = el('div', { style: 'font-size:32px;letter-spacing:8px;' }, ['🐸 🦆 🐧 🦦']);
  root.append(bubbleBox, logo, sub, prompt);
}

import { net } from '../net.js';
