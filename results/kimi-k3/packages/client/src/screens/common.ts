export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

let toastTimer: number | null = null;

export function toast(msg: string, ms = 3000): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast' }, [msg]);
  document.body.append(t);
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), ms);
}

export function showApp(): void {
  document.getElementById('app')!.classList.remove('hidden');
  document.getElementById('game')!.classList.add('hidden');
  document.getElementById('hud')!.classList.add('hidden');
}

export function showGame(): void {
  document.getElementById('app')!.classList.add('hidden');
  document.getElementById('game')!.classList.remove('hidden');
  document.getElementById('hud')!.classList.remove('hidden');
}

export function fitGameCanvas(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / 256, window.innerHeight / 224)));
  canvas.style.width = `${256 * scale}px`;
  canvas.style.height = `${224 * scale}px`;
}

window.addEventListener('resize', fitGameCanvas);
