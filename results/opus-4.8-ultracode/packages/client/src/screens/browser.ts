import type { Mode } from '@splash/shared';
import { net } from '../net';
import { nav, type ScreenInstance } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';

export function mount(root: HTMLElement): ScreenInstance {
  const el = screenEl();
  let filter: Mode | 'all' = 'all';
  const refresh = (): void => net.send({ type: 'room_list_request', mode: filter });
  refresh();
  const timer = setInterval(refresh, 3000);

  function render(): void {
    clearNode(el);
    const rooms = store.roomList.filter((r) => filter === 'all' || r.mode === filter);
    el.append(
      h('div', { class: 'row between' }, [
        h('div', { class: 'title', style: 'font-size:24px', text: 'Public Rooms' }),
        h('div', { class: 'row' }, [
          btn('Refresh', { onclick: refresh }),
          btn('Back', { onclick: () => nav.go('menu') }),
        ]),
      ]),
      h('div', { class: 'row' }, [
        tab('All', filter === 'all', () => setFilter('all')),
        tab('2-Player', filter === 'duel', () => setFilter('duel')),
        tab('4-Player', filter === 'ffa', () => setFilter('ffa')),
      ]),
      rooms.length
        ? h('div', { class: 'list' }, rooms.map(roomRow))
        : h('div', { class: 'subtitle', text: 'No open rooms. Create one from the menu!' }),
    );
  }

  function roomRow(r: import('@splash/shared').RoomListItem): HTMLElement {
    return h('div', { class: 'list-row', style: 'grid-template-columns: 1fr auto auto auto' }, [
      h('div', {}, [
        h('div', { style: 'font-weight:700', text: r.name }),
        h('div', { class: 'small muted', text: `${r.host} · ${themeName(r.theme)}` }),
      ]),
      h('span', { class: 'chip', text: r.mode === 'duel' ? '2P' : '4P' }),
      h('span', { class: 'chip', text: `${r.players}/${r.max}` }),
      r.inProgress
        ? h('span', { class: 'chip', text: 'in match' })
        : btn('Join', { variant: 'primary', disabled: r.players >= r.max, onclick: () => net.send({ type: 'join_room', code: r.code }) }),
    ]);
  }

  function setFilter(m: Mode | 'all'): void {
    filter = m;
    refresh();
    render();
  }

  const unsub = store.subscribe(render);
  render();
  root.append(el);
  return {
    unmount() {
      clearInterval(timer);
      unsub();
      el.remove();
    },
  };
}

function tab(label: string, active: boolean, onclick: () => void): HTMLElement {
  return btn(label, { variant: active ? 'primary' : 'ghost', onclick });
}

function themeName(t: string): string {
  return { backyard: 'Backyard', beach: 'Beach', pool: 'Pool Party', random: 'Random' }[t] ?? t;
}
