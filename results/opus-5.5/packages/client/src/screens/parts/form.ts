// Dialog form layout: labelled rows in a two-column grid, plus a pending state for the submit
// button while a request is in flight.
import { h, type Child } from '../../ui';
import './styles/dialogs.css';

/** One "LABEL  [control]" row. */
export function formRow(label: string, control: Child): HTMLElement {
  return h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, label), h('div', { class: 'form-control' }, control));
}

export function formGrid(...rows: Child[]): HTMLElement {
  return h('div', { class: 'form-grid' }, ...rows);
}

/** Toggle a button between its normal label and a disabled "working" label. */
export function setPending(btn: HTMLButtonElement | null | undefined, pending: boolean, pendingLabel = 'Working...'): void {
  if (!btn) return;
  const label = btn.querySelector<HTMLElement>('.btn-label');
  if (!label) return;
  if (pending) {
    btn.dataset.idleLabel ??= label.textContent ?? '';
    label.textContent = pendingLabel;
  } else if (btn.dataset.idleLabel !== undefined) {
    label.textContent = btn.dataset.idleLabel;
  }
  btn.disabled = pending;
}

/** The modal's action button at `index` (actions render in the order they were given). */
export function modalButton(modalEl: HTMLElement, index: number): HTMLButtonElement | null {
  return modalEl.querySelectorAll<HTMLButtonElement>('.modal-actions .btn')[index] ?? null;
}
