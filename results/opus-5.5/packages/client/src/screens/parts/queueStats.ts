// Queue status panel: elapsed time (ticking locally between queue_status updates), current
// search range with its widening bar, ETA, players in queue and the player's rating in this mode.
import { tierBand, type Mode } from '@splash/shared';
import { store, type QueueInfo } from '../../store';
import { h, type Child } from '../../ui';
import { etaText, formatClockMs, modeLabel, rangeProgress, rangeText } from './format';
import type { Scope } from './scope';
import { progressBar } from './shell';
import { tierBadgeEl } from './sprite';

const TICK_MS = 250;

function cell(label: string, ...value: Child[]): HTMLElement {
  return h('div', { class: 'qs-cell' }, h('span', { class: 'qs-label' }, label), h('div', { class: 'qs-value' }, ...value));
}

function ratingLine(mode: Mode): HTMLElement | null {
  const r = store.get().profile?.ratings[mode];
  if (!r) return null;
  const band = tierBand(r.rating);
  return h(
    'div',
    { class: 'qs-rating' },
    tierBadgeEl(r.tier),
    h('span', null, `Your ${modeLabel(mode)} rating`),
    h('span', { class: 'qs-elo' }, String(r.rating)),
    h('span', { class: 'qs-tier' }, band.name),
  );
}

export function queueStats(s: Scope, mode: Mode): HTMLElement {
  let base = { elapsedMs: 0, at: Date.now() };
  let info: QueueInfo | null = store.get().queue;
  const time = h('span', null, '00:00');
  const range = h('span', null, '--');
  const eta = h('span', null, '--');
  const inQueue = h('span', null, '--');
  const bar = progressBar(0, 'range', 'Search range widening');

  const adopt = (q: QueueInfo | null) => {
    info = q && q.mode === mode ? q : null;
    if (!info) return;
    base = { elapsedMs: info.elapsedMs, at: Date.now() };
    range.textContent = rangeText(info.searchRange);
    bar.set(rangeProgress(info.searchRange));
    eta.textContent = etaText(info.eta);
    inQueue.textContent = String(Math.max(1, info.inQueue));
  };
  const tick = () => (time.textContent = formatClockMs(base.elapsedMs + Date.now() - base.at));

  adopt(info);
  tick();
  s.interval(tick, TICK_MS);
  s.add(
    store.subscribe((next, prev) => {
      if (next.queue !== prev.queue) adopt(next.queue);
    }),
  );
  return h(
    'div',
    { class: 'queue-stats' },
    h(
      'div',
      { class: 'qs-grid' },
      cell('Time', time),
      cell('Range', range, bar.el),
      cell('ETA', eta),
      cell('In queue', inQueue),
    ),
    ratingLine(mode),
  );
}
