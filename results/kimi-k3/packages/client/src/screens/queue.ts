import { GameMode } from '@splash/shared';
import { net } from '../net.js';
import { el, showApp, toast } from './common.js';

export function renderQueue(root: HTMLElement, go: (screen: string) => void, mode: GameMode): void {
  showApp();
  const start = Date.now();
  let searching = true;

  const needNick = net.profile && !hasCustomNick();
  const box = el('div', { class: 'panel col', style: 'align-items:center;min-width:340px;' });

  if (needNick) {
    box.append(
      el('h2', {}, ['NICKNAME REQUIRED']),
      el('div', { class: 'dim' }, ['Set a nickname before playing ranked.']),
    );
    const input = el('input', { type: 'text', maxlength: '16', placeholder: '3-16 characters' }) as HTMLInputElement;
    const save = el('button', {}, ['SAVE & QUEUE']);
    save.onclick = () => {
      const v = input.value.trim();
      if (v.length < 3) {
        toast('Too short');
        return;
      }
      net.send({ t: 'set_nickname', nickname: v });
      setTimeout(() => {
        net.send({ t: 'queue_join', mode });
        drawSearching();
      }, 400);
    };
    const back = el('button', { class: 'secondary' }, ['BACK']);
    back.onclick = () => go('menu');
    box.append(input, el('div', { class: 'row' }, [save, back]));
    root.append(box);
    return;
  }

  net.send({ t: 'queue_join', mode });
  drawSearching();

  function drawSearching(): void {
    box.innerHTML = '';
    box.append(
      el('h2', {}, [mode === 'duel' ? 'RANKED DUEL' : 'RANKED FFA']),
      el('div', { style: 'font-size:22px;' }, ['🔍']),
    );
    const status = el('div', { class: 'dim' }, ['Searching...']);
    const range = el('div', { class: 'small dim' }, ['']);
    const timer = el('div', { style: 'font-size:18px;color:#73eff7;' }, ['0:00']);
    const cancel = el('button', { class: 'danger' }, ['CANCEL']);
    cancel.onclick = () => {
      net.send({ t: 'queue_leave' });
      go('menu');
    };
    box.append(status, range, timer, cancel);
    root.innerHTML = '';
    root.append(box);

    const int = window.setInterval(() => {
      if (!searching) {
        clearInterval(int);
        return;
      }
      const s = Math.floor((Date.now() - start) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    cleanup.push(() => clearInterval(int));

    const off = net.on('queue_status', (msg) => {
      status.textContent = `Searching ${msg.mode.toUpperCase()} — ${msg.inQueue} in queue, ETA ~${msg.eta}s`;
      range.textContent = `search range: ±${msg.searchRange} rating`;
    });
    cleanup.push(off);
  }
}

function hasCustomNick(): boolean {
  return net.profile?.customNickname !== false;
}

export const cleanup: (() => void)[] = [];
