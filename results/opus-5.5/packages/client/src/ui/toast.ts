// Toast notifications: a short stack at the top of the UI overlay, just below the mounted
// screen's title bar when it has one (a toast must never hide the heading of the screen it lands
// on). A repeat of the newest toast refreshes it instead of stacking duplicates. Click a toast to
// dismiss it early.
import { audio } from '../audio';
import { frame } from '../frame';
import { h } from './dom';
import { layer } from './layers';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

const MAX_TOASTS = 3;
const DEFAULT_DURATION_MS = 3200;
const LEAVE_MS = 160;

const timers = new WeakMap<HTMLElement, number>();

/** The mounted screen's title bar (see screenShell). */
const SCREEN_HEADER = '.screen-root .shell-head';

function dismiss(el: HTMLElement): void {
  window.clearTimeout(timers.get(el));
  timers.delete(el);
  if (el.classList.contains('toast-leaving')) return;
  el.classList.add('toast-leaving');
  window.setTimeout(() => el.remove(), LEAVE_MS);
}

function arm(el: HTMLElement, durationMs: number): void {
  window.clearTimeout(timers.get(el));
  timers.set(el, window.setTimeout(() => dismiss(el), durationMs));
}

function liveToasts(stack: HTMLElement): HTMLElement[] {
  return [...stack.children].filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('toast-leaving'),
  );
}

/**
 * Moves the stack just below the mounted screen's title bar, or back to the top edge on screens
 * without one. The offset is kept in backbuffer pixels, so a new UI scale needs no re-measure;
 * the router calls this after every screen change.
 */
export function placeToasts(): void {
  const stack = layer('toasts');
  const head = document.querySelector<HTMLElement>(SCREEN_HEADER);
  const below = head ? (head.getBoundingClientRect().bottom - stack.getBoundingClientRect().top) / Math.max(1, frame.scale) : 0;
  stack.style.setProperty('--toast-top', String(Math.max(0, Math.round(below))));
}

/** Dismiss every toast now (a match intro is taking over the whole screen). */
export function clearToasts(): void {
  for (const el of liveToasts(layer('toasts'))) dismiss(el);
}

/** Show a toast (error toasts also play the error blip). */
export function toast(msg: string, kind: ToastKind = 'info', durationMs = DEFAULT_DURATION_MS): void {
  if (kind === 'error') audio.sfx('error');
  const stack = layer('toasts');
  placeToasts();
  const live = liveToasts(stack);
  const newest = live[live.length - 1];
  if (newest && newest.dataset.msg === msg && newest.dataset.kind === kind) {
    newest.classList.remove('toast-bump');
    void newest.offsetWidth; // restart the bump animation
    newest.classList.add('toast-bump');
    arm(newest, durationMs);
    return;
  }
  const el = h(
    'div',
    {
      class: `toast toast-${kind}`,
      role: kind === 'error' ? 'alert' : 'status',
      dataset: { msg, kind },
      onClick: () => dismiss(el),
    },
    msg,
  );
  stack.append(el);
  arm(el, durationMs);
  for (const old of live.slice(0, Math.max(0, live.length + 1 - MAX_TOASTS))) dismiss(old);
}
