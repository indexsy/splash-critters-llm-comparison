/** Small DOM builders so screens read like the markup they produce. */

type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  disabled?: boolean;
  hidden?: boolean;
  value?: string;
  type?: string;
  href?: string;
  placeholder?: string;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  checked?: boolean;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title) node.title = props.title;
  if (props.hidden) node.hidden = true;
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  if (props.style) Object.assign(node.style, props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);

  const anyNode = node as unknown as Record<string, unknown>;
  if (props.disabled !== undefined) anyNode.disabled = props.disabled;
  if (props.value !== undefined) anyNode.value = props.value;
  if (props.type !== undefined) anyNode.type = props.type;
  if (props.href !== undefined) anyNode.href = props.href;
  if (props.placeholder !== undefined) anyNode.placeholder = props.placeholder;
  if (props.maxLength !== undefined) anyNode.maxLength = props.maxLength;
  if (props.min !== undefined) anyNode.min = props.min;
  if (props.max !== undefined) anyNode.max = props.max;
  if (props.step !== undefined) anyNode.step = props.step;
  if (props.checked !== undefined) anyNode.checked = props.checked;

  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      node.addEventListener(event, handler as EventListener);
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: ButtonVariant; disabled?: boolean; title?: string; wide?: boolean } = {},
): HTMLButtonElement {
  const classes = ['btn', `btn-${opts.variant ?? 'secondary'}`];
  if (opts.wide) classes.push('btn-wide');
  return el('button', {
    class: classes.join(' '),
    text: label,
    disabled: opts.disabled,
    title: opts.title,
    type: 'button',
    on: { click: onClick },
  });
}

export function panel(title: string | null, ...children: Child[]): HTMLDivElement {
  return el('div', { class: 'panel' }, title ? el('h2', { class: 'panel-title', text: title }) : null, ...children);
}

export function row(...children: Child[]): HTMLDivElement {
  return el('div', { class: 'row' }, ...children);
}

export function field(label: string, control: Node, hint?: string): HTMLLabelElement {
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    control,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  );
}

/** Screen scaffold: back chevron, title, then content. */
export function screenShell(
  title: string,
  onBack: (() => void) | null,
  ...children: Child[]
): HTMLDivElement {
  return el(
    'div',
    { class: 'screen-shell' },
    el(
      'header',
      { class: 'screen-head' },
      onBack ? button('< Back', onBack, { variant: 'ghost' }) : el('span', { class: 'spacer' }),
      el('h1', { class: 'screen-title', text: title }),
      el('span', { class: 'spacer' }),
    ),
    el('div', { class: 'screen-body' }, ...children),
  );
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
