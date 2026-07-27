/**
 * Ranked queue screen. The matchmaker owns the truth (queue_status), so this
 * screen only interpolates the clock between updates and gives the player one
 * obvious way out.
 */

import { CONFIG, type GameMode } from '@splash/shared';
import { playSfx, startMusic } from '../audio';
import { send } from '../net';
import { UI, shade } from '../render/palette';
import { drawBalloon, drawCritterIcon } from '../render/sprites';
import { drawText } from '../render/text';
import type { Screen } from '../router';
import { currentPath, navigate } from '../router';
import { STAGE_HEIGHT, STAGE_WIDTH, getContext, showStage } from '../stage';
import { getState, setState, subscribe } from '../store';
import { button, el, panel, screenShell } from '../ui/dom';

const MODE_NAMES: Record<GameMode, string> = {
  duel: 'Ranked Duel',
  ffa: 'Ranked Free-for-All',
};

function isMode(value: string): value is GameMode {
  return value === 'duel' || value === 'ffa';
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function statRow(label: string, value: string): HTMLElement {
  return el('div', { class: 'spread' }, el('span', { class: 'muted', text: label }), el('span', { text: value }));
}

export function createQueueScreen(): Screen {
  let mode: GameMode = 'duel';
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  /** False when the route carried a mode this game does not have. */
  let mounted = false;
  let elapsedAnchorMs = 0;
  let anchorAt = performance.now();
  let lastClock = '';
  let statsSignature = '';
  let animation = 0;

  const timer = el('p', { class: 'big-number center', text: '0:00' });
  const stats = el('div', { class: 'stack' });
  const connection = el('p', { class: 'field-hint center', text: '' });

  function elapsedMs(): number {
    return elapsedAnchorMs + (performance.now() - anchorAt);
  }

  function cancel(): void {
    cancelled = true;
    playSfx('ui_back');
    send({ t: 'queue_leave' });
    setState({ queue: null });
    navigate('/menu');
  }

  function renderStats(): void {
    const state = getState();
    const queue = state.queue && state.queue.mode === mode ? state.queue : null;
    const next = queue
      ? `${queue.searchRange}|${queue.waiting}|${queue.eta ?? -1}|${state.connected}`
      : `none|${state.connected}`;
    if (next === statsSignature) return;
    statsSignature = next;

    connection.textContent = state.connected
      ? ''
      : 'Connection lost. You leave the queue until the game reconnects.';

    if (!queue) {
      stats.replaceChildren(
        statRow('Mode', MODE_NAMES[mode]),
        statRow('Status', state.connected ? 'Contacting the matchmaker' : 'Offline'),
        statRow('Rating window', `+/- ${CONFIG.MM_RANGE_START}`),
      );
      return;
    }

    stats.replaceChildren(
      statRow('Mode', MODE_NAMES[mode]),
      statRow('Rating window', `+/- ${queue.searchRange}`),
      statRow('Critters queued', `${queue.waiting}`),
      statRow('Estimated wait', queue.eta === null ? 'Working it out' : `about ${clock(queue.eta * 1000)}`),
    );
  }

  function syncClock(): void {
    const queue = getState().queue;
    if (!queue || queue.mode !== mode) return;
    elapsedAnchorMs = queue.elapsedMs;
    anchorAt = performance.now();
  }

  function onStateChange(): void {
    syncClock();
    renderStats();
  }

  function drawWaitingRoom(): void {
    const ctx = getContext();
    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    ctx.fillStyle = shade(UI.water, 0.6);
    ctx.fillRect(0, 150, STAGE_WIDTH, STAGE_HEIGHT - 150);
    ctx.fillStyle = shade(UI.waterLight, 0.35);
    const drift = Math.floor((animation * 14) % 24);
    for (let x = -24 + drift; x < STAGE_WIDTH; x += 24) {
      ctx.fillRect(x, 154, 8, 1);
      ctx.fillRect(x + 12, 162, 5, 1);
    }

    drawText(ctx, MODE_NAMES[mode], STAGE_WIDTH / 2, 28, UI.gold, { align: 'center', shadow: UI.shadow, scale: 1 });
    const dots = '.'.repeat(1 + (Math.floor(animation * 2) % 3));
    drawText(ctx, `Searching${dots}`, STAGE_WIDTH / 2, 46, UI.ink, { align: 'center', shadow: UI.shadow });

    // Balloons orbiting the waiting critter, so the screen is never static.
    const cx = STAGE_WIDTH / 2;
    const cy = 110;
    for (let i = 0; i < 4; i++) {
      const angle = animation * 1.2 + (i * Math.PI) / 2;
      drawBalloon(ctx, Math.round(cx + Math.cos(angle) * 42), Math.round(cy + Math.sin(angle) * 20), 0.3, i);
    }

    const profile = getState().profile;
    const look = {
      slot: 0,
      animal: profile?.selectedAnimal ?? ('frog' as const),
      hat: profile?.selectedHat ?? ('none' as const),
    };
    const bob = Math.sin(animation * 4) > 0 ? 0 : 1;
    drawCritterIcon(ctx, look, cx, cy + bob);

    drawText(ctx, clock(elapsedMs()), STAGE_WIDTH / 2, 140, UI.inkDim, { align: 'center', shadow: UI.shadow });
  }

  return {
    mount(host, params) {
      const raw = (params.mode ?? '').toLowerCase();
      if (!isMode(raw)) {
        navigate('/menu', true);
        return;
      }
      mode = raw;
      mounted = true;
      showStage(true);
      startMusic('menu');
      syncClock();

      host.appendChild(
        screenShell(
          MODE_NAMES[mode],
          cancel,
          panel('Searching', timer, stats, connection),
          panel(
            null,
            button('Cancel search', cancel, { variant: 'danger', wide: true }),
            el('p', {
              class: 'field-hint',
              text: 'The rating window widens the longer you wait, so a match always turns up eventually.',
            }),
          ),
        ),
      );

      renderStats();
      unsubscribe = subscribe(onStateChange);
    },

    unmount() {
      unsubscribe?.();
      unsubscribe = null;
      showStage(false);
      if (cancelled || !mounted) return;
      // Leaving by any other route (back button, a stray link) must not leave a
      // ghost in the queue. Heading into the match we just found is the one case
      // where the queue entry is meant to disappear on its own.
      const path = currentPath();
      if (!path.startsWith('/room/') && path !== '/game') send({ t: 'queue_leave' });
    },

    frame(dtMs) {
      animation += dtMs / 1000;
      const next = clock(elapsedMs());
      if (next !== lastClock) {
        lastClock = next;
        timer.textContent = next;
      }
      drawWaitingRoom();
    },
  };
}
