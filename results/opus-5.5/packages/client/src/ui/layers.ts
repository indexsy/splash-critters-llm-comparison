// Stacked overlay layers inside frame.ui, above the mounted screen (which app.ts keeps as the
// first child). Created lazily, always kept in this bottom-to-top order.
import { frame } from '../frame';
import { h } from './dom';

export type LayerName = 'badges' | 'banner' | 'toasts' | 'modals';

const ORDER: readonly LayerName[] = ['badges', 'banner', 'toasts', 'modals'];
const layers = new Map<LayerName, HTMLDivElement>();

export function layer(name: LayerName): HTMLDivElement {
  const existing = layers.get(name);
  if (existing) return existing;
  const el = h('div', { class: `layer layer-${name}` });
  const above = ORDER.slice(ORDER.indexOf(name) + 1)
    .map((n) => layers.get(n))
    .find((l): l is HTMLDivElement => l !== undefined);
  frame.ui.insertBefore(el, above ?? null);
  layers.set(name, el);
  return el;
}
