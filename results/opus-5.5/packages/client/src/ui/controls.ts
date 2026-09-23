// Form controls in the pixel style: button, text input, segmented picker, toggle, slider.
// Stateful controls return a Control<T> so screens can re-sync them (e.g. when settings change
// elsewhere) without re-rendering: `ctl.set(v)` updates the view without firing onChange.
import { audio, type SfxName } from '../audio';
import { h, uid } from './dom';
import { installHotkeys, keyLabel } from './hotkeys';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonOptions {
  variant?: ButtonVariant;
  /** KeyboardEvent.code that clicks this button while it is visible (see hotkeys.ts). */
  hotkey?: string;
  disabled?: boolean;
  small?: boolean;
  /** Tooltip / accessible description. */
  title?: string;
  /** Click sound; defaults to ui_back for Escape-hotkey buttons, else ui_select. null = silent. */
  sound?: SfxName | null;
}

export function button(label: string, onClick: (e: MouseEvent) => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const classes = ['btn', `btn-${opts.variant ?? 'secondary'}`, opts.small ? 'btn-sm' : ''].filter(Boolean);
  const sound = opts.sound === undefined ? (opts.hotkey === 'Escape' ? 'ui_back' : 'ui_select') : opts.sound;
  const handleClick = (e: MouseEvent) => {
    if (sound) audio.sfx(sound);
    onClick(e);
  };
  const btn = h(
    'button',
    { type: 'button', class: classes.join(' '), disabled: opts.disabled ?? false, title: opts.title, onClick: handleClick },
    h('span', { class: 'btn-label' }, label),
    opts.hotkey ? h('span', { class: 'kbd', 'aria-hidden': 'true' }, keyLabel(opts.hotkey)) : null,
  );
  if (opts.hotkey) {
    btn.dataset.hotkey = opts.hotkey;
    btn.setAttribute('aria-keyshortcuts', keyLabel(opts.hotkey));
    installHotkeys();
  }
  return btn;
}

export interface TextInputOptions {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  /** Accessible name (also the visible placeholder when none is given). */
  label: string;
  autofocus?: boolean;
  /** Normalises every edit, e.g. room codes: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''). */
  transform?: (value: string) => string;
  onInput?: (value: string) => void;
  onEnter?: (value: string) => void;
}

export function textInput(opts: TextInputOptions): HTMLInputElement {
  const el = h('input', {
    type: 'text',
    class: 'text-input',
    value: opts.value ?? '',
    placeholder: opts.placeholder ?? opts.label,
    maxlength: opts.maxLength,
    'aria-label': opts.label,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  el.addEventListener('input', () => {
    if (opts.transform) {
      const next = opts.transform(el.value);
      if (next !== el.value) el.value = next;
    }
    opts.onInput?.(el.value);
  });
  el.addEventListener('keydown', (e) => {
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && opts.onEnter) {
      e.preventDefault();
      opts.onEnter(el.value);
    }
  });
  if (opts.autofocus) requestAnimationFrame(() => el.isConnected && el.focus());
  return el;
}

/** A stateful control: its element, current value and a silent setter. */
export interface Control<T> {
  readonly el: HTMLElement;
  readonly value: T;
  set(value: T): void;
}

export interface SegmentOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Radio-group picker (e.g. DUEL | FFA). Arrow keys move between enabled options. */
export function segmented<T extends string | number>(
  options: readonly SegmentOption<T>[],
  initial: T,
  onChange: (value: T) => void,
  ariaLabel: string,
): Control<T> {
  let current = initial;
  const buttons = options.map((opt) =>
    h(
      'button',
      { type: 'button', class: 'seg-option', role: 'radio', disabled: opt.disabled ?? false, onClick: () => choose(opt.value) },
      opt.label,
    ),
  );
  const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': ariaLabel }, buttons);

  function render(): void {
    options.forEach((opt, i) => {
      const on = opt.value === current;
      buttons[i].setAttribute('aria-checked', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
    });
  }

  function choose(value: T): void {
    if (value === current) return;
    current = value;
    render();
    audio.sfx('ui_move');
    onChange(value);
  }

  el.addEventListener('keydown', (e) => {
    const step = e.code === 'ArrowRight' || e.code === 'ArrowDown' ? 1 : e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const at = enabled.findIndex((o) => o.value === current);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    choose(next.value);
    buttons[options.indexOf(next)].focus();
  });

  render();
  return {
    el,
    get value() {
      return current;
    },
    set(value: T) {
      current = value;
      render();
    },
  };
}

/** ON/OFF switch with a visible label. */
export function toggle(label: string, initial: boolean, onChange: (on: boolean) => void): Control<boolean> {
  let current = initial;
  const state = h('span', { class: 'toggle-state', 'aria-hidden': 'true' });
  const el = h(
    'button',
    {
      type: 'button',
      class: 'toggle',
      role: 'switch',
      onClick: () => {
        current = !current;
        render();
        audio.sfx('ui_move');
        onChange(current);
      },
    },
    h('span', { class: 'toggle-label' }, label),
    state,
  );

  function render(): void {
    el.setAttribute('aria-checked', String(current));
    state.textContent = current ? 'On' : 'Off';
  }

  render();
  return {
    el,
    get value() {
      return current;
    },
    set(value: boolean) {
      current = value;
      render();
    },
  };
}

export interface SliderOptions {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  /** Readout text; defaults to a percentage of the 0..1 range. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

/** Labelled range slider with a live readout. onChange fires while dragging. */
export function slider(opts: SliderOptions): Control<number> {
  const format = opts.format ?? ((v: number) => `${Math.round(v * 100)}%`);
  const id = uid('slider');
  const range = h('input', {
    id,
    type: 'range',
    class: 'slider-input',
    min: opts.min ?? 0,
    max: opts.max ?? 1,
    step: opts.step ?? 0.05,
    value: String(opts.value),
  });
  const readout = h('output', { class: 'slider-value', for: id }, format(opts.value));
  range.addEventListener('input', () => {
    const v = Number(range.value);
    readout.textContent = format(v);
    opts.onChange(v);
  });
  const el = h('div', { class: 'slider' }, h('label', { class: 'slider-label', htmlFor: id }, opts.label), readout, range);
  return {
    el,
    get value() {
      return Number(range.value);
    },
    set(value: number) {
      range.value = String(value);
      readout.textContent = format(value);
    },
  };
}
