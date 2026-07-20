import type { Mode } from '@splash/shared';
import { fetchLeaderboard, net } from '../net';
import { nav, type ScreenInstance } from '../router';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';

export function mount(root: HTMLElement): ScreenInstance {
  void net;
  const el = screenEl();
  let mode: Mode = 'duel';
  void fetchLeaderboard(mode);

  function render(): void {
    clearNode(el);
    const lb = store.leaderboard;
    const rows = lb && lb.mode === mode ? lb.entries : [];
    el.append(
      h('div', { class: 'row between' }, [
        h('div', { class: 'title', style: 'font-size:26px', text: 'Leaderboard' }),
        btn('Back', { onclick: () => nav.go('menu') }),
      ]),
      h('div', { class: 'row' }, [
        tab('Duel', mode === 'duel', () => switchMode('duel')),
        tab('Free-for-All', mode === 'ffa', () => switchMode('ffa')),
      ]),
      rows.length
        ? table(rows)
        : h('div', { class: 'subtitle', text: lb ? 'No ranked games played yet — be the first!' : 'Loading…' }),
    );
  }

  function switchMode(m: Mode): void {
    mode = m;
    render();
    void fetchLeaderboard(m);
  }

  const unsub = store.subscribe(render);
  render();
  root.append(el);
  return {
    unmount() {
      unsub();
      el.remove();
    },
  };
}

function tab(label: string, active: boolean, onclick: () => void): HTMLElement {
  return btn(label, { variant: active ? 'primary' : 'ghost', onclick });
}

function table(rows: import('@splash/shared').LeaderboardEntry[]): HTMLElement {
  const t = h('table');
  t.append(
    h('tr', {}, [th('#'), th('Critter'), th('Tier'), th('Rating'), th('W/L'), th('Win%')]),
  );
  for (const r of rows) {
    t.append(
      h('tr', {}, [
        td(String(r.rank)),
        td(r.displayName),
        tdColor(r.tierName, tierColor(r.tier)),
        td(String(r.rating)),
        td(`${r.wins}/${r.games - r.wins}`),
        td(`${r.winrate}%`),
      ]),
    );
  }
  return t;
}

function th(t: string): HTMLElement {
  return h('th', { text: t });
}
function td(t: string): HTMLElement {
  return h('td', { text: t });
}
function tdColor(t: string, color: string): HTMLElement {
  return h('td', { text: t, style: `color:${color};font-weight:700` });
}
function tierColor(tier: string): string {
  return (
    { puddle: '#9fb4e6', pond: '#4ee66a', river: '#34d1ff', lake: '#7c8cff', ocean: '#c58cff', tsunami: '#ffd23f' }[
      tier
    ] ?? '#eaf2ff'
  );
}
