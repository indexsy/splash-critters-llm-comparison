// Settings tab 2: remap every action (primary + alternate key). Selecting a key cell captures
// the next key press (Esc cancels, Backspace/Delete clears); a key taken from another action is
// moved and the player is told, including when that leaves the other action with no key.
import { input } from '../../input';
import { BIND_ACTIONS, BIND_LABELS, MAX_BINDS_PER_ACTION, settings, type BindAction } from '../../settings';
import { button, h, keyLabel, toast } from '../../ui';
import { bindOwner, CLEAR_KEYS, unboundActions } from './keybinds';
import { navKey, rerender } from './refocus';
import type { Scope } from './scope';

export function keybindTable(scope: Scope): HTMLElement {
  const rows = h('div', { class: 'kb-rows', role: 'grid', 'aria-label': 'Key bindings' });
  let capturing: { action: BindAction; index: number } | null = null;
  let cancelCapture: (() => void) | null = null;
  scope.add(() => cancelCapture?.());

  const apply = (action: BindAction, index: number, code: string) => {
    if (CLEAR_KEYS.has(code)) {
      settings.bindKey(action, index, null);
      return;
    }
    const before = settings.get().keybinds;
    if (before[action][index] === code) return;
    const owner = bindOwner(before, code, action);
    settings.bindKey(action, index, code);
    if (!owner) return;
    const orphaned = unboundActions(settings.get().keybinds).includes(owner);
    toast(orphaned ? `${keyLabel(code)} moved here. ${BIND_LABELS[owner]} has no key now!` : `${keyLabel(code)} moved from ${BIND_LABELS[owner]}`, 'warn');
  };

  const capture = (action: BindAction, index: number) => {
    cancelCapture?.();
    capturing = { action, index };
    render();
    cancelCapture = input.captureNextKey((code) => {
      cancelCapture = null;
      capturing = null;
      if (code !== null) apply(action, index, code);
      render();
    });
  };

  const keyCell = (action: BindAction, index: number, code: string | undefined) => {
    const active = capturing?.action === action && capturing.index === index;
    const label = active ? 'Press a key' : code ? keyLabel(code) : '--';
    const btn = navKey(button(label, () => capture(action, index), { small: true, variant: active ? 'primary' : 'secondary', title: `Change: ${BIND_LABELS[action]}` }), `kb-${action}-${index}`);
    btn.classList.add('kb-key');
    if (active) btn.classList.add('blink');
    if (!code && !active) btn.classList.add('is-empty');
    return btn;
  };

  const row = (action: BindAction) => {
    const codes = settings.get().keybinds[action];
    const cells = Array.from({ length: MAX_BINDS_PER_ACTION }, (_, i) => keyCell(action, i, codes[i]));
    const missing = codes.length === 0;
    return h('div', { class: `kb-row${missing ? ' is-missing' : ''}`, role: 'row' }, h('span', { class: 'kb-label' }, BIND_LABELS[action]), ...cells);
  };

  function render(): void {
    rerender(rows, () => BIND_ACTIONS.map(row));
  }

  render();
  scope.add(
    settings.subscribe((next, prev) => {
      if (next.keybinds !== prev.keybinds) render();
    }),
  );

  const reset = button('Reset to defaults', () => {
    cancelCapture?.();
    capturing = null;
    settings.resetKeybinds();
    render();
    toast('Controls reset to defaults', 'success');
  }, { small: true, variant: 'ghost' });

  return h(
    'div',
    { class: 'kb' },
    h('div', { class: 'kb-head' }, h('span', { class: 'muted-note' }, 'Pick a key, then press the new one. Esc cancels, Delete clears.'), reset),
    h('div', { class: 'kb-cols', 'aria-hidden': 'true' }, h('span', null, 'Action'), h('span', null, 'Key'), h('span', null, 'Alt key')),
    rows,
  );
}
