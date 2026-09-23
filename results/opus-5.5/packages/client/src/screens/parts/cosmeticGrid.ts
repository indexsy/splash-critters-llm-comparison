// Locker grid of cosmetic tiles (animals or hats). Owned tiles are pickable; locked ones are
// greyed with "Lv N" and a lock, and explain themselves instead. The grid tracks which tile is
// being looked at (under a moving pointer, else keyboard focus) so the screen can preview it,
// and reports when that stops so the screen can fall back to the saved look.
import type { CosmeticDef } from '@splash/shared';
import { getGlyph } from '../../render/sprites';
import { button, h, toast } from '../../ui';
import { sectionLabel } from './shell';
import { spriteEl } from './sprite';

export interface CosmeticGridOptions<T extends string> {
  label: string;
  defs: readonly CosmeticDef<T>[];
  isOwned: (def: CosmeticDef<T>) => boolean;
  selected: T;
  sprite: (id: T) => HTMLCanvasElement;
  className: string;
  onPick: (id: T) => void;
  /** The tile being looked at changed (read it with `inspected()`); null-safe to call anytime. */
  onInspect: () => void;
}

/** A tile the player is looking at. */
export interface CosmeticInspection<T extends string> {
  def: CosmeticDef<T>;
  locked: boolean;
  /** Under the pointer (a hover wins over keyboard focus in another grid). */
  hovered: boolean;
}

export interface CosmeticGrid<T extends string> {
  readonly el: HTMLElement;
  /** Re-render the tiles (selection, ownership or sprites changed). */
  render(selected: T): void;
  /** The tile under the pointer, else the focused tile, else null. */
  inspected(): CosmeticInspection<T> | null;
}

export function cosmeticGrid<T extends string>(opts: CosmeticGridOptions<T>): CosmeticGrid<T> {
  const grid = h('div', { class: `cos-grid ${opts.className}`, role: 'radiogroup', 'aria-label': opts.label });
  let hovered: CosmeticDef<T> | null = null;
  let focused: CosmeticDef<T> | null = null;

  const defOf = (target: EventTarget | null): CosmeticDef<T> | null => {
    const tileEl = target instanceof Element ? target.closest<HTMLElement>('.cos-tile') : null;
    return tileEl ? (opts.defs.find((d) => d.id === tileEl.dataset.cosId) ?? null) : null;
  };
  const setHovered = (def: CosmeticDef<T> | null) => {
    if (def === hovered) return;
    hovered = def;
    opts.onInspect();
  };
  const setFocused = (def: CosmeticDef<T> | null) => {
    if (def === focused) return;
    focused = def;
    opts.onInspect();
  };

  // Grid-level listeners survive re-renders. Hover follows real pointer movement only, so a
  // tile that merely appears under a resting cursor (the Locker button sits where a tile lands)
  // is not taken for a look.
  grid.addEventListener('pointermove', (e) => setHovered(defOf(e.target)));
  grid.addEventListener('pointerleave', () => setHovered(null));
  grid.addEventListener('focusin', (e) => setFocused(defOf(e.target)));
  grid.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node && grid.contains(e.relatedTarget))) setFocused(null);
  });

  const tile = (def: CosmeticDef<T>, selected: T): HTMLButtonElement => {
    const locked = !opts.isOwned(def);
    const btn = button('', () => {
      if (locked) {
        toast(`${def.name} unlocks at level ${def.unlockLevel}`, 'info');
        return;
      }
      opts.onPick(def.id);
    }, { sound: locked ? 'error' : 'ui_select', title: locked ? `${def.name}: unlocks at level ${def.unlockLevel}` : def.name });
    btn.className = ['cos-tile', locked ? 'is-locked' : '', def.id === selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(def.id === selected));
    btn.setAttribute('aria-label', locked ? `${def.name}, locked until level ${def.unlockLevel}` : def.name);
    btn.dataset.navKey = `cos-${def.id}`;
    btn.dataset.cosId = def.id;
    btn.replaceChildren(spriteEl(opts.sprite(def.id), 1, 'cos-sprite'));
    if (locked) btn.append(spriteEl(getGlyph('lock'), 1, 'cos-lock-icon'), h('span', { class: 'cos-lock' }, `Lv ${def.unlockLevel}`));
    return btn;
  };

  const render = (selected: T) => {
    const focusedKey = document.activeElement instanceof HTMLElement && grid.contains(document.activeElement) ? document.activeElement.dataset.navKey : undefined;
    grid.replaceChildren(...opts.defs.map((def) => tile(def, selected)));
    if (focusedKey) grid.querySelector<HTMLElement>(`[data-nav-key="${focusedKey}"]`)?.focus({ preventScroll: true });
  };

  const inspected = (): CosmeticInspection<T> | null => {
    const def = hovered ?? focused;
    return def ? { def, locked: !opts.isOwned(def), hovered: def === hovered } : null;
  };

  render(opts.selected);
  return { el: h('section', { class: 'cos-section' }, sectionLabel(opts.label), grid), render, inspected };
}
