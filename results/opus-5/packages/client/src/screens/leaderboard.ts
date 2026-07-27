/**
 * Ranked leaderboard. Reads the REST endpoint rather than the socket because the
 * board is a snapshot, not live state, and a plain fetch survives a dropped
 * WebSocket.
 */

import {
  CONFIG,
  displayName,
  type GameMode,
  type LeaderboardResponse,
  type LeaderboardRow,
} from '@splash/shared';
import { navigate, type Screen } from '../router';
import { getState } from '../store';
import { button, el, panel, screenShell } from '../ui/dom';

type Status = 'loading' | 'ready' | 'failed';

const MODES: { id: GameMode; label: string }[] = [
  { id: 'duel', label: 'Duel' },
  { id: 'ffa', label: 'Free-for-All' },
];

function tierName(id: LeaderboardRow['tier']): string {
  return CONFIG.RANK_TIERS.find((t) => t.id === id)?.name ?? id;
}

/** Wins over games, so the display never depends on how the API scales winrate. */
function winratePercent(row: LeaderboardRow): string {
  if (row.games <= 0) return '0%';
  return `${Math.round((row.wins / row.games) * 100)}%`;
}

function boardTable(rows: LeaderboardRow[], playerId: string | null): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', { text: '#' }),
    el('th', { text: 'Critter' }),
    el('th', { text: 'Rating' }),
    el('th', { text: 'Tier' }),
    el('th', { text: 'Games' }),
    el('th', { text: 'Winrate' }),
  );
  const body = rows.map((row) =>
    el(
      'tr',
      { class: playerId !== null && row.playerId === playerId ? 'is-you' : '' },
      el('td', { text: String(row.rank) }),
      el('td', { text: displayName(row.nickname, row.tag) }),
      el('td', { text: String(row.rating) }),
      el('td', {}, el('span', { class: `tier tier-${row.tier}`, text: tierName(row.tier) })),
      el('td', { text: String(row.games) }),
      el('td', { text: winratePercent(row) }),
    ),
  );
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...body));
}

export function createLeaderboardScreen(): Screen {
  let mounted = false;
  let controller: AbortController | null = null;
  let mode: GameMode = 'duel';
  let status: Status = 'loading';
  let rows: LeaderboardRow[] = [];
  let failure = '';

  const body = el('div', { class: 'stack' });
  const modeRow = el('div', { class: 'row' });

  function renderModes(): void {
    modeRow.replaceChildren(
      ...MODES.map((entry) => {
        const control = button(entry.label, () => pick(entry.id), {
          variant: entry.id === mode ? 'primary' : 'secondary',
        });
        control.setAttribute('aria-pressed', entry.id === mode ? 'true' : 'false');
        return control;
      }),
    );
  }

  function renderBody(): void {
    if (status === 'loading') {
      body.replaceChildren(el('div', { class: 'center muted', text: 'Loading the board...' }));
      return;
    }
    if (status === 'failed') {
      body.replaceChildren(
        el('div', { class: 'center', text: 'Could not load the leaderboard.' }),
        el('div', { class: 'center muted', text: failure }),
      );
      return;
    }
    if (rows.length === 0) {
      body.replaceChildren(
        el('div', { class: 'center muted', text: 'No ranked matches have been played in this mode yet.' }),
        el('div', { class: 'center muted', text: 'Play a ranked match and you will be rank 1.' }),
      );
      return;
    }
    body.replaceChildren(boardTable(rows, getState().playerId));
  }

  async function load(): Promise<void> {
    controller?.abort();
    const active = new AbortController();
    controller = active;
    status = 'loading';
    renderBody();
    renderModes();

    try {
      const response = await fetch(`/api/leaderboard?mode=${mode}`, {
        signal: active.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Server responded ${response.status}.`);
      const payload = (await response.json()) as LeaderboardResponse;
      if (!mounted || controller !== active) return;
      rows = Array.isArray(payload.rows) ? payload.rows : [];
      status = 'ready';
    } catch (error) {
      if (!mounted || controller !== active) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failure = error instanceof Error ? error.message : 'The server could not be reached.';
      status = 'failed';
    }
    renderBody();
    renderModes();
  }

  function pick(next: GameMode): void {
    if (next === mode) return;
    mode = next;
    rows = [];
    void load();
  }

  return {
    mount(host: HTMLElement): void {
      mounted = true;
      renderModes();
      renderBody();
      host.appendChild(
        screenShell(
          'Leaderboard',
          () => navigate('/menu'),
          panel(
            'Top Critters',
            modeRow,
            body,
            el(
              'div',
              { class: 'row' },
              button('Refresh', () => void load(), { variant: 'secondary' }),
              el('span', { class: 'field-hint', text: 'Ratings update when a ranked match ends.' }),
            ),
          ),
        ),
      );
      void load();
    },

    unmount(): void {
      mounted = false;
      controller?.abort();
      controller = null;
    },
  };
}
