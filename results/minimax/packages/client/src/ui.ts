/** Tiny DOM helpers - the menus are plain HTML over the pixel canvas. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'string') {
      node.addEventListener(key.slice(2).toLowerCase(), () => {
        (node as unknown as { __handler?: () => void }).__handler?.();
      });
    } else if (key === 'value' && node instanceof HTMLInputElement) {
      node.value = String(value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  className = '',
  disabled = false,
): HTMLButtonElement {
  const b = el('button', { class: className, type: 'button', disabled }, [label]);
  b.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return b;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function panel(
  title: string,
  ...children: (Node | string)[]
): HTMLDivElement {
  return el('div', { class: 'panel' }, [
    el('h1', {}, [title]),
    ...children.filter((c): c is Node | string => c !== null),
  ]);
}

/** Same as panel but pinned to the bottom so the canvas stays visible. */
export function bottomPanel(title: string, ...children: (Node | string)[]): HTMLDivElement {
  return el('div', { class: 'panel bottom' }, [
    el('h1', {}, [title]),
    ...children.filter((c): c is Node | string => c !== null),
  ]);
}

export function row(...children: (Node | string)[]): HTMLDivElement {
  return el('div', { class: 'row' }, children);
}

export function col(...children: (Node | string)[]): HTMLDivElement {
  return el('div', { class: 'col' }, children);
}

export function card(...children: (Node | string)[]): HTMLDivElement {
  return el('div', { class: 'card' }, children);
}

export function tierPill(tier: string): HTMLSpanElement {
  return el('span', { class: `pill ${tier.toLowerCase()}` }, [tier]);
}
