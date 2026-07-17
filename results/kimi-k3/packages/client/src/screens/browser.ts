import { GameMode, RoomSummary } from '@splash/shared';
import { net } from '../net.js';
import { el, showApp, toast } from './common.js';

export function renderBrowser(root: HTMLElement, go: (screen: string, data?: unknown) => void): void {
  showApp();
  let filter: GameMode | 'all' = 'all';
  const title = el('h2', {}, ['PUBLIC ROOMS']);
  const tabs = el('div', { class: 'tab-row' });
  const list = el('div', { class: 'scroll', style: 'min-width:480px;min-height:200px;' });
  let rooms: RoomSummary[] = [];

  const draw = (): void => {
    list.innerHTML = '';
    const shown = rooms.filter((r) => filter === 'all' || (filter === 'duel' ? r.size === 2 : r.size === 4));
    if (shown.length === 0) {
      list.append(el('div', { class: 'dim', style: 'padding:20px;text-align:center;' }, ['No open rooms — create one!']));
      return;
    }
    for (const r of shown) {
      const join = el('button', { style: 'padding:4px 10px;font-size:11px;' }, ['JOIN']);
      join.onclick = () => {
        net.send({ t: 'join_room', code: r.code });
        go('lobby');
      };
      list.append(
        el('div', { class: 'room-row' }, [
          el('span', { style: 'color:#73eff7;font-weight:bold;' }, [r.name]),
          el('span', { class: 'tier-badge' }, [r.size === 2 ? 'DUEL' : 'FFA']),
          el('span', {}, [`${r.players}/${r.maxPlayers}`]),
          el('span', { class: 'dim' }, [r.theme]),
          el('span', { class: 'dim small' }, [`host: ${r.host}`]),
          el('span', { class: 'spacer' }),
          join,
        ]),
      );
    }
  };

  for (const f of ['all', 'duel', 'ffa'] as const) {
    const b = el('button', { class: filter === f ? 'active' : '', style: 'padding:6px 12px;font-size:11px;' }, [f.toUpperCase()]);
    b.onclick = () => {
      filter = f;
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      draw();
    };
    tabs.append(b);
  }

  const refresh = el('button', { class: 'secondary' }, ['REFRESH']);
  refresh.onclick = () => net.send({ t: 'room_list_request' });
  const back = el('button', { class: 'secondary' }, ['BACK']);
  back.onclick = () => go('menu');

  const off = net.on('room_list', (msg) => {
    rooms = msg.rooms;
    draw();
  });
  net.send({ t: 'room_list_request' });
  const interval = window.setInterval(() => net.send({ t: 'room_list_request' }), 4000);
  cleanup.push(() => {
    off();
    clearInterval(interval);
  });

  root.append(title, tabs, list, el('div', { class: 'row' }, [refresh, back]));
}

export const cleanup: (() => void)[] = [];
