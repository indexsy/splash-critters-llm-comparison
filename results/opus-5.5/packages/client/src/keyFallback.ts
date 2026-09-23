// Every keyboard handler in the client reads KeyboardEvent.code (layout-independent physical
// keys). Some input sources leave `code` empty: remote-desktop and streaming clients, certain
// virtual keyboards and automation tools. This window capture-phase listener runs before any
// other handler and fills in `code` from `key` for those events, so they drive the game too.

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Shift: 'ShiftLeft',
  Control: 'ControlLeft',
  Alt: 'AltLeft',
  Meta: 'MetaLeft',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  '\\': 'Backslash',
};

/** The physical-key code a key value most likely came from ('' when unknown). */
export function codeFromKey(key: string): string {
  if (NAMED_KEYS[key]) return NAMED_KEYS[key];
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  // Multi-character key values (Enter, Escape, Tab, ArrowUp, F1, Home...) match their code.
  return key.length > 1 ? key : '';
}

function fillMissingCode(e: KeyboardEvent): void {
  if (e.code) return;
  const code = codeFromKey(e.key);
  if (code) Object.defineProperty(e, 'code', { value: code });
}

/** Install once at boot, before any other keyboard listener. */
export function installKeyCodeFallback(): void {
  window.addEventListener('keydown', fillMissingCode, { capture: true });
  window.addEventListener('keyup', fillMissingCode, { capture: true });
}
