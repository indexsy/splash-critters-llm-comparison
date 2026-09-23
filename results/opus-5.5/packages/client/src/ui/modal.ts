// Modal dialogs over the UI overlay: backdrop, Escape (runs the modal's Esc action, else closes
// when dismissible), focus trap and focus restore. Modals stack; only the top one reacts to keys
// and hotkeys.
import { append, h, uid } from './dom';
import { button, type ButtonVariant } from './controls';
import { hotkeyButton } from './hotkeys';
import { layer } from './layers';

export interface ModalAction {
  label: string;
  variant?: ButtonVariant;
  hotkey?: string;
  /** Runs on click; the modal then closes unless this returns false. */
  onClick?: () => boolean | void;
}

export interface ModalOptions {
  title: string;
  body: string | Node;
  /** Defaults to a single "OK" button. Pass [] for a modal without buttons. */
  actions?: ModalAction[];
  /** Escape / backdrop click close it (default true). */
  dismissible?: boolean;
  onClose?: () => void;
}

export interface ModalHandle {
  readonly el: HTMLElement;
  close(): void;
}

interface OpenModal {
  backdrop: HTMLElement;
  box: HTMLElement;
  dismissible: boolean;
  close(): void;
}

const stack: OpenModal[] = [];
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

function trapTab(e: KeyboardEvent, box: HTMLElement): void {
  const items = focusables(box);
  if (items.length === 0) {
    e.preventDefault();
    box.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && box.contains(active);
  if (e.shiftKey && (active === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Escape belongs to the top modal and never reaches the screen underneath. It runs the modal's
 * own Escape action when there is one (e.g. "No (Esc)", so its onClick and sound happen), else
 * closes a dismissible modal. Auto-repeat is swallowed so holding Escape cannot cascade.
 */
function onEscape(e: KeyboardEvent, top: OpenModal): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  const action = hotkeyButton(top.box, 'Escape');
  if (action) action.click();
  else if (top.dismissible) top.close();
}

function onKeyDown(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.code === 'Escape') onEscape(e, top);
  else if (e.code === 'Tab') trapTab(e, top.box);
}

let installed = false;

function installKeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeyDown, true);
}

export function modal(opts: ModalOptions): ModalHandle {
  installKeys();
  const dismissible = opts.dismissible ?? true;
  const titleId = uid('modal-title');
  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const actions = (opts.actions ?? [{ label: 'OK', variant: 'primary' }]).map((a) =>
    button(
      a.label,
      () => {
        if (a.onClick?.() !== false) close();
      },
      { variant: a.variant, hotkey: a.hotkey },
    ),
  );
  const body = h('div', { class: 'modal-body' });
  append(body, opts.body);
  const box = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1 },
    h('h2', { id: titleId, class: 'modal-title' }, opts.title),
    body,
    actions.length > 0 ? h('div', { class: 'modal-actions' }, actions) : null,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissible) close();
  });

  let open = true;
  function close(): void {
    if (!open) return;
    open = false;
    const at = stack.indexOf(entry);
    if (at >= 0) stack.splice(at, 1);
    backdrop.remove();
    if (restoreFocus?.isConnected) restoreFocus.focus();
    opts.onClose?.();
  }

  const entry: OpenModal = { backdrop, box, dismissible, close };
  stack.push(entry);
  layer('modals').append(backdrop);
  const field = body.querySelector<HTMLElement>('input, textarea, select');
  (field ?? actions[0] ?? focusables(box)[0] ?? box).focus();
  return { el: box, close };
}

/** Close every open modal (top first). Used when the route changes. */
export function closeAllModals(): void {
  for (const m of [...stack].reverse()) m.close();
}
