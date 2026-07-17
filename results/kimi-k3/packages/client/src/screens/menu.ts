import { net } from '../net.js';
import { audio } from '../audio.js';
import { el, showApp, toast } from './common.js';

export function renderMenu(root: HTMLElement, go: (screen: string, data?: unknown) => void): void {
  showApp();
  audio.playMusic('menu');
  const p = net.profile;
  const header = el('h2', {}, ['SPLASH CRITTERS']);
  const who = el('div', { class: 'dim' }, [
    p ? `${p.nickname}#${p.tag} — Level ${p.level} (${p.xp} XP)` : 'loading...',
  ]);

  const list = el('div', { class: 'menu-list' });
  const mk = (label: string, fn: () => void, cls = '') => {
    const b = el('button', { class: cls }, [label]);
    b.onclick = fn;
    list.append(b);
    return b;
  };

  mk('▶ RANKED DUEL (1v1)', () => go('queue', 'duel'));
  mk('▶ RANKED FREE-FOR-ALL (4p)', () => go('queue', 'ffa'));
  mk('CASUAL — BROWSE ROOMS', () => go('browser'), 'secondary');
  mk('CASUAL — CREATE ROOM', () => go('lobby', 'create'), 'secondary');
  mk('JOIN BY CODE', () => {
    const code = prompt('Enter 6-char room code:');
    if (code && code.trim().length === 6) {
      net.send({ t: 'join_room', code: code.trim().toUpperCase() });
      go('lobby');
    } else if (code !== null) toast('Invalid code');
  }, 'secondary');
  mk('PRACTICE VS BOTS', () => go('lobby', 'practice'), 'secondary');
  mk('LEADERBOARD', () => go('leaderboard'), 'secondary');
  mk('LOCKER', () => go('locker'), 'secondary');
  mk('HOW TO PLAY', () => go('howto'), 'secondary');
  mk('SETTINGS', () => go('settings'), 'secondary');

  root.append(header, who, list);
}
