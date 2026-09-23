// Button hotkeys. A button created with `hotkey: 'Escape'` carries data-hotkey; one global
// listener clicks the newest visible, enabled matching button (inside the top modal when one
// is open). Game keys claimed by input.ts during gameplay arrive defaultPrevented and are
// ignored; text fields only let Escape through; Enter/Space on a focused control stay native.
import { frame } from '../frame';
import { isTypingTarget, isVisible } from './dom';

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Bksp',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt',
  AltRight: 'R-Alt',
  MetaLeft: 'L-Meta',
  MetaRight: 'R-Meta',
  CapsLock: 'Caps',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** Short human label for a KeyboardEvent.code ('KeyW' -> 'W', 'ArrowUp' -> 'Up'). */
export function keyLabel(code: string): string {
  const named = NAMED_KEYS[code];
  if (named) return named;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Num ${numpad[1]}`;
  return code;
}

const NATIVE_ACTIVATION = 'button, a[href], input, select, textarea, summary, [role="button"], [role="switch"], [role="radio"], [role="option"]';

function activatesNatively(e: KeyboardEvent): boolean {
  const enterOrSpace = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
  return enterOrSpace && e.target instanceof Element && e.target.matches(NATIVE_ACTIVATION);
}

function hotkeyScope(): ParentNode {
  const modals = frame.ui.querySelectorAll('.modal');
  return modals.length > 0 ? modals[modals.length - 1] : frame.ui;
}

/** The newest visible, enabled button inside `scope` whose hotkey is `code`, if any. */
export function hotkeyButton(scope: ParentNode, code: string): HTMLButtonElement | null {
  const matches = scope.querySelectorAll<HTMLButtonElement>(`button[data-hotkey="${CSS.escape(code)}"]`);
  const usable = [...matches].filter((b) => !b.disabled && isVisible(b));
  return usable[usable.length - 1] ?? null;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target) && e.code !== 'Escape') return;
  if (activatesNatively(e)) return;
  const target = hotkeyButton(hotkeyScope(), e.code === 'NumpadEnter' ? 'Enter' : e.code);
  if (!target) return;
  e.preventDefault();
  target.click();
}

let installed = false;

/** Install the single global hotkey listener (idempotent; done lazily by button()). */
export function installHotkeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeyDown);
}
