import { el, showApp } from './common.js';

interface LbEntry {
  rank: number;
  playerId: string;
  nickname: string;
  tag: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}

export function renderLeaderboard(root: HTMLElement, go: (screen: string) => void): void {
  showApp();
  let mode: 'duel' | 'ffa' = 'duel';
  const title = el('h2', {}, ['LEADERBOARD']);
  const tabs = el('div', { class: 'tab-row' });
  const list = el('div', { class: 'scroll', style: 'min-width:560px;min-height:280px;' });

  const load = async (): Promise<void> => {
    list.innerHTML = '';
    list.append(el('div', { class: 'dim' }, ['Loading...']));
    try {
      const res = await fetch(`/api/leaderboard?mode=${mode}`);
      const data = (await res.json()) as { entries: LbEntry[] };
      list.innerHTML = '';
      if (data.entries.length === 0) {
        list.append(el('div', { class: 'dim', style: 'padding:20px;' }, ['No ranked matches yet — be the first!']));
      }
      for (const e of data.entries) {
        list.append(
          el('div', { class: 'lb-row' }, [
            el('span', { style: 'width:36px;color:#ffd23c;' }, [`#${e.rank}`]),
            el('span', { style: 'min-width:160px;' }, [`${e.nickname}`, el('span', { class: 'dim small' }, [`#${e.tag}`])]),
            el('span', { style: 'width:60px;color:#73eff7;' }, [String(e.rating)]),
            el('span', { class: 'tier-badge' }, [e.tier]),
            el('span', { class: 'small dim' }, [`${e.games} games`]),
            el('span', { class: 'small' }, [`${e.winrate}% WR`]),
          ]),
        );
      }
    } catch {
      list.innerHTML = '';
      list.append(el('div', { class: 'bad' }, ['Failed to load']));
    }
  };

  for (const m of ['duel', 'ffa'] as const) {
    const b = el('button', { class: m === mode ? 'active' : '', style: 'padding:6px 14px;font-size:11px;' }, [m.toUpperCase()]);
    b.onclick = () => {
      mode = m;
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      void load();
    };
    tabs.append(b);
  }

  const back = el('button', { class: 'secondary' }, ['BACK']);
  back.onclick = () => go('menu');
  root.append(title, tabs, list, back);
  void load();
}
