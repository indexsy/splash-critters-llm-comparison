// Console-style arrow-key navigation for menu screens and their dialogs: arrows move focus to
// the nearest control in that direction (inside the top modal when one is open), Enter/Space
// activate the focused control natively and Escape is left to the button hotkeys ("Back").
// Left/Right stay native inside text fields, sliders and segmented pickers; Up/Down always
// move between rows so a picker never traps the cursor.
import { audio } from '../../audio';
import { isTypingTarget } from '../../ui';
import { arrowDir, pickNeighbor, type Box } from './spatial';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function topModal(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>('.layer-modals .modal');
  return modals.length > 0 ? modals[modals.length - 1] : null;
}

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && !el.closest('[hidden], [inert]');
}

function focusables(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Horizontal arrows that the focused control uses itself (caret, slider value, picker). */
function ownsHorizontal(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (isTypingTarget(el)) return true;
  if (el instanceof HTMLInputElement && el.type === 'range') return true;
  return el.closest('.seg') !== null;
}

/** Focus the scope's preferred control: [data-autofocus], else the first focusable one. */
export function focusInitial(scope: HTMLElement): void {
  const preferred = scope.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred && visible(preferred) && !(preferred as HTMLButtonElement).disabled ? preferred : focusables(scope)[0];
  target?.focus({ preventScroll: true });
}

function move(e: KeyboardEvent, root: HTMLElement): void {
  const dir = arrowDir(e.code);
  if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
  const scope = topModal() ?? root;
  if (!scope.isConnected) return;
  const active = document.activeElement;
  const horizontal = dir === 'left' || dir === 'right';
  if (horizontal && ownsHorizontal(active)) return;
  const items = focusables(scope);
  if (items.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  const current = active instanceof HTMLElement ? items.indexOf(active.closest<HTMLElement>(FOCUSABLE) ?? active) : -1;
  if (current < 0) {
    focusInitial(scope);
    return;
  }
  const others = items.filter((_, i) => i !== current);
  const pick = pickNeighbor(boxOf(items[current]), others.map(boxOf), dir);
  if (pick < 0) return;
  others[pick].focus({ preventScroll: true });
  others[pick].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  audio.sfx('ui_move');
}

/**
 * Install arrow navigation for a mounted screen. Runs in the capture phase so Up/Down leave a
 * segmented picker instead of cycling it. Returns the uninstall function.
 */
export function installArrowNav(root: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => move(e, root);
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
