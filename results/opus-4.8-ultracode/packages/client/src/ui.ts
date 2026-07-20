/**
 * Tiny DOM helpers for building the menu screens (no framework).
 */

export type Attrs = {
  class?: string;
  text?: string;
  html?: string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  style?: string;
  title?: string;
  [key: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'onclick') el.addEventListener('click', v as EventListener);
    else if (k === 'oninput') el.addEventListener('input', v as EventListener);
    else if (k === 'onchange') el.addEventListener('change', v as EventListener);
    else if (k === 'disabled') (el as HTMLButtonElement).disabled = Boolean(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else if (k === 'maxLength') (el as HTMLInputElement).maxLength = Number(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) el.append(c);
  return el;
}

export function btn(label: string, opts: Attrs & { variant?: string } = {}): HTMLButtonElement {
  const cls = `btn ${opts.variant ?? ''} ${opts.class ?? ''}`.trim();
  return h('button', { ...opts, class: cls, text: label });
}

export function screenEl(narrow = false): HTMLDivElement {
  return h('div', { class: `screen panel ${narrow ? 'narrow' : ''}` });
}

export function clearNode(el: HTMLElement): void {
  el.replaceChildren();
}

let toastRoot: HTMLElement | null = null;
export function toast(msg: string, bad = false): void {
  if (!toastRoot) toastRoot = document.getElementById('toast');
  if (!toastRoot) return;
  const item = h('div', { class: `toast-item ${bad ? 'bad' : ''}`, text: msg });
  toastRoot.append(item);
  setTimeout(() => {
    item.style.opacity = '0';
    setTimeout(() => item.remove(), 300);
  }, 2200);
}
