// Shared menu chrome: the standard screen layout (pixel title bar, BACK on Escape, tool slot,
// framed body) plus small building blocks every menu screen reuses (bars, chips, labels,
// nickname#tag).
import { button, h, pixelTitle, type Child } from '../../ui';
import { nameTag } from './format';
import './styles/base.css';

export interface ShellOptions {
  title: string;
  /** Adds a BACK button bound to Escape. */
  onBack?: () => void;
  backLabel?: string;
  /** Header content on the right (e.g. a Refresh button). */
  tools?: Child;
  /** Header content on the left when there is no BACK button (e.g. a mode tag). */
  lead?: Child;
  className?: string;
  /** Pixel scale of the title (default 2; long names use 1). */
  titleScale?: number;
  /** Title glyph colour (default sand). */
  titleColor?: string;
}

/** Full-screen menu layout: title bar + framed body. Returns the outer element. */
export function screenShell(opts: ShellOptions, ...body: Child[]): HTMLElement {
  const back = opts.onBack ? button(opts.backLabel ?? 'Back', opts.onBack, { variant: 'ghost', small: true, hotkey: 'Escape' }) : null;
  return h(
    'div',
    { class: ['shell', 'screen-fill', opts.className].filter(Boolean).join(' ') },
    h(
      'header',
      { class: 'shell-head' },
      h('div', { class: 'shell-left' }, back ?? opts.lead ?? null),
      h('div', { class: 'shell-title' }, pixelTitle(opts.title.toUpperCase(), opts.titleScale ?? 2, { color: opts.titleColor })),
      h('div', { class: 'shell-right' }, opts.tools ?? null),
    ),
    h('div', { class: 'shell-body' }, ...body),
  );
}

/** Replace the pixel title of a shell built by screenShell (e.g. when the room changes). */
export function setShellTitle(shell: HTMLElement, title: string, scale = 2): void {
  shell.querySelector('.shell-title')?.replaceChildren(pixelTitle(title.toUpperCase(), scale));
}

export interface ProgressBar {
  readonly el: HTMLElement;
  /** 0..1 fill. */
  set(fraction: number): void;
}

/** Chunky pixel progress bar; `tone` picks the fill colour (xp | tier | range | vote). */
export function progressBar(fraction: number, tone: 'xp' | 'tier' | 'range' | 'vote' = 'xp', label?: string): ProgressBar {
  const fill = h('div', { class: 'bar-fill' });
  const el = h('div', { class: `bar bar-${tone}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  const set = (f: number) => {
    const v = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
    fill.style.setProperty('--p', String(v));
    el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  set(fraction);
  return { el, set };
}

/** Small tag chip ("DUEL", "PRIVATE", "FIRST TO 3"). */
export function chip(text: Child, tone: 'plain' | 'water' | 'sand' | 'coral' | 'teal' = 'plain'): HTMLElement {
  return h('span', { class: `chip chip-${tone}` }, text);
}

/** Dim section heading with a dashed rule. */
export function sectionLabel(text: string): HTMLElement {
  return h('div', { class: 'section-label' }, h('span', null, text));
}

/** "Nickname#tag" where only the nickname truncates, so the #tag always stays visible. */
export function nameTagEl(name: string, tag: string, className = ''): HTMLElement {
  return h(
    'span',
    { class: ['name-tag', className].filter(Boolean).join(' '), title: nameTag(name, tag) },
    h('span', { class: 'nt-name' }, name),
    tag ? h('span', { class: 'nt-tag' }, `#${tag}`) : null,
  );
}
