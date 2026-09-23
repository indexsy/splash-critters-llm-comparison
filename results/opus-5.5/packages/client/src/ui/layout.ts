// Structural helpers: pixel panels, loading dots, scrollable lists and tables.
import { audio } from '../audio';
import { h, type Child } from './dom';

export interface PanelOptions {
  title?: string;
  className?: string;
}

/** Bordered pixel panel with an optional title bar. */
export function panel(opts: PanelOptions | null, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: ['panel', opts?.className].filter(Boolean).join(' ') },
    opts?.title ? h('h2', { class: 'panel-title' }, opts.title) : null,
    h('div', { class: 'panel-body' }, ...children),
  );
}

/** Animated "loading..." dots, optionally after a label. */
export function spinner(label?: string): HTMLElement {
  return h(
    'span',
    { class: 'spinner', role: 'status' },
    label ? h('span', { class: 'spinner-label' }, label) : null,
    h('span', { class: 'spinner-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
  );
}

export interface ListOptions<T> {
  /** Shown instead of the list when there are no items. */
  empty?: string;
  /** Makes rows focusable and clickable (Enter/Space activate). */
  onSelect?: (item: T, index: number) => void;
  className?: string;
}

/** Scrollable pixel list; each item rendered by `render`. */
export function list<T>(items: readonly T[], render: (item: T, index: number) => Child, opts: ListOptions<T> = {}): HTMLElement {
  if (items.length === 0 && opts.empty) return h('div', { class: 'list-empty' }, opts.empty);
  const select = opts.onSelect;
  const rows = items.map((item, i) => {
    if (!select) return h('li', { class: 'list-item' }, render(item, i));
    const activate = () => {
      audio.sfx('ui_select');
      select(item, i);
    };
    return h(
      'li',
      {
        class: 'list-item list-item-selectable',
        role: 'button',
        tabIndex: 0,
        onClick: activate,
        onKeydown: (e: KeyboardEvent) => {
          if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
          e.preventDefault();
          activate();
        },
      },
      render(item, i),
    );
  });
  return h('ul', { class: ['list', 'scroll', opts.className].filter(Boolean).join(' ') }, rows);
}

export interface TableColumn<T> {
  label: string;
  cell: (row: T, index: number) => Child;
  align?: 'left' | 'center' | 'right';
}

export interface TableOptions<T> {
  empty?: string;
  /** Extra class for a row, e.g. highlighting the local player. */
  rowClass?: (row: T, index: number) => string | undefined;
  className?: string;
}

/** Scrollable table with a sticky header row. */
export function table<T>(columns: readonly TableColumn<T>[], rows: readonly T[], opts: TableOptions<T> = {}): HTMLElement {
  if (rows.length === 0 && opts.empty) return h('div', { class: 'list-empty' }, opts.empty);
  const alignClass = (c: TableColumn<T>) => `cell-${c.align ?? 'left'}`;
  const head = h('thead', null, h('tr', null, columns.map((c) => h('th', { class: alignClass(c), scope: 'col' }, c.label))));
  const body = h(
    'tbody',
    null,
    rows.map((row, i) =>
      h('tr', { class: opts.rowClass?.(row, i) }, columns.map((c) => h('td', { class: alignClass(c) }, c.cell(row, i)))),
    ),
  );
  return h('div', { class: ['table-wrap', 'scroll', opts.className].filter(Boolean).join(' ') }, h('table', { class: 'table' }, head, body));
}
