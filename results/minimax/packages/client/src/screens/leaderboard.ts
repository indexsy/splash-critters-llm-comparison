import type { App } from '../app.js';
import { button, clear, el, panel, tierPill } from '../ui.js';

interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
  winRate: number;
  tier: string;
}

/** Top 100 for both rating pools. */
export class LeaderboardScreen {
  private app: App | null = null;
  private mode: 'duel' | 'ffa' = 'duel';
  private body: HTMLDivElement | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    this.body = el('div', {});
    const root = panel(
      'Leaderboard',
      el('div', { class: 'row' }, [
        button('Duel', () => {
          this.mode = 'duel';
          this.refresh();
        }),
        button('Free-for-all', () => {
          this.mode = 'ffa';
          this.refresh();
        }),
        button('Refresh', () => this.refresh()),
        button('Back', () => app.go('menu')),
      ]),
      this.body,
    );
    app.overlay.appendChild(root);
    this.refresh();
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* static */
  }

  private async refresh(): Promise<void> {
    const body = this.body;
    if (!body) return;
    clear(body);
    body.appendChild(el('p', { class: 'muted' }, ['Loading…']));
    try {
      const response = await fetch(`/api/leaderboard?mode=${this.mode}&limit=100`);
      const data = (await response.json()) as { entries: LeaderboardEntry[] };
      clear(body);
      if (!data.entries || data.entries.length === 0) {
        body.appendChild(el('p', { class: 'muted' }, ['No ranked games yet - be the first!']));
        return;
      }
      const table = el('table', {}, [
        el('tr', {}, [
          el('th', {}, ['#']),
          el('th', {}, ['Player']),
          el('th', {}, ['Tier']),
          el('th', {}, ['Rating']),
          el('th', {}, ['Games']),
          el('th', {}, ['Win %']),
        ]),
      ]);
      for (const entry of data.entries) {
        table.appendChild(
          el('tr', {}, [
            el('td', {}, [String(entry.rank)]),
            el('td', {}, [`${entry.nickname}#${entry.tag}`]),
            el('td', {}, [tierPill(entry.tier)]),
            el('td', {}, [String(entry.rating)]),
            el('td', {}, [String(entry.games)]),
            el('td', {}, [`${Math.round(entry.winRate * 100)}%`]),
          ]),
        );
      }
      body.appendChild(table);
    } catch {
      clear(body);
      body.appendChild(el('p', { class: 'muted' }, ['Could not load the leaderboard.']));
    }
  }
}
