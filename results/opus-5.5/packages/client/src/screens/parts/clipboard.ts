// Copy text to the clipboard: the async Clipboard API when allowed, else a hidden textarea +
// execCommand('copy'); if both fail, the text is shown in a dialog to copy by hand.
import { h, modal, toast } from '../../ui';

function legacyCopy(text: string): boolean {
  const area = h('textarea', { class: 'clipboard-scratch', readonly: true, 'aria-hidden': 'true' });
  area.value = text;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: fall through to the legacy path.
  }
  return legacyCopy(text);
}

function showManualCopy(text: string): void {
  const field = h('input', { class: 'text-input selectable', readonly: true, value: text, 'aria-label': 'Room link' });
  modal({ title: 'Copy this link', body: h('div', { class: 'col' }, h('p', { class: 'muted-note' }, 'Your browser blocked copying. Select the link and copy it yourself:'), field) });
  field.select();
}

/** Copy `text`, toasting `successMsg` on success; falls back to a manual-copy dialog. */
export async function copyWithFeedback(text: string, successMsg: string): Promise<void> {
  if (await writeClipboard(text)) toast(successMsg, 'success');
  else showManualCopy(text);
}
