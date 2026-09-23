// Minimal DOM builder: h(tag, attrs, ...children). Attribute rules:
//  - `class` / `className` set the class list; `dataset` merges data-* entries;
//  - `style` accepts an object (custom properties like '--w' included);
//  - on* keys with a function value become event listeners (onClick -> 'click');
//  - DOM properties that hold live state (value, checked, disabled, ...) are set as properties;
//  - true -> empty attribute, false/null/undefined -> omitted, anything else -> String(value).

export type Child = Node | string | number | null | undefined | false | readonly Child[];
export type Attrs = Record<string, unknown>;

const PROPERTY_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'tabIndex', 'htmlFor', 'textContent']);

function applyStyle(el: HTMLElement, style: unknown): void {
  if (!style || typeof style !== 'object') return;
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('--')) el.style.setProperty(key, String(value));
    else (el.style as unknown as Record<string, string>)[key] = String(value);
  }
}

function applyAttr(el: HTMLElement, key: string, value: unknown): void {
  if (key === 'class' || key === 'className') {
    if (value) el.className = String(value);
  } else if (key === 'dataset') {
    for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) {
      if (v !== null && v !== undefined) el.dataset[k] = String(v);
    }
  } else if (key === 'style') {
    applyStyle(el, value);
  } else if (key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
  } else if (PROPERTY_KEYS.has(key)) {
    (el as unknown as Record<string, unknown>)[key] = value;
  } else if (value === true) {
    el.setAttribute(key, '');
  } else if (value !== false && value !== null && value !== undefined) {
    el.setAttribute(key, String(value));
  }
}

/** Append children, flattening arrays and skipping null/undefined/false. */
export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, ...(child as readonly Child[]));
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [key, value] of Object.entries(attrs)) applyAttr(el, key, value);
  append(el, ...children);
  return el;
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** True when keystrokes on `target` are text entry (inputs, textareas, selects, contenteditable). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

/** True when the element is rendered (not display:none and attached). */
export function isVisible(el: Element): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

let idCounter = 0;

/** Unique DOM id for aria wiring (labels, descriptions). */
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
