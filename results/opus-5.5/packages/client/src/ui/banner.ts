// A single status strip across the top of the UI overlay (connection lost, update needed).
import { append, h } from './dom';
import { button } from './controls';
import { layer } from './layers';
import { spinner } from './layout';

export interface BannerOptions {
  /** Show animated loading dots after the text. */
  busy?: boolean;
  action?: { label: string; onClick: () => void };
}

export interface Banner {
  show(text: string, opts?: BannerOptions): void;
  hide(): void;
}

export function createBanner(): Banner {
  const el = h('div', { class: 'banner', role: 'status', 'aria-live': 'polite', hidden: true });
  layer('banner').append(el);
  let shown = '';
  return {
    show(text: string, opts: BannerOptions = {}) {
      const key = `${text}|${opts.busy ? 1 : 0}|${opts.action?.label ?? ''}`;
      el.hidden = false;
      if (key === shown) return;
      shown = key;
      el.replaceChildren();
      append(
        el,
        opts.busy ? spinner(text) : h('span', null, text),
        opts.action ? button(opts.action.label, opts.action.onClick, { variant: 'primary', small: true }) : null,
      );
    },
    hide() {
      el.hidden = true;
      shown = '';
    },
  };
}
