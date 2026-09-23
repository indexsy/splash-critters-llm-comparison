// Host-only slot chooser: set a non-human lobby slot to Open, Closed or a bot of a chosen
// difficulty (set_slot). The current setting is highlighted and focused.
import type { Difficulty, SlotView } from '@splash/shared';
import { net } from '../../net';
import { button, h, modal, toast } from '../../ui';

interface SlotChoice {
  label: string;
  kind: 'open' | 'closed' | 'bot';
  difficulty?: Difficulty;
}

const CHOICES: readonly SlotChoice[] = [
  { label: 'Open for players', kind: 'open' },
  { label: 'Bot: Easy', kind: 'bot', difficulty: 'easy' },
  { label: 'Bot: Medium', kind: 'bot', difficulty: 'medium' },
  { label: 'Bot: Hard', kind: 'bot', difficulty: 'hard' },
  { label: 'Closed', kind: 'closed' },
];

function isCurrent(slot: SlotView, c: SlotChoice): boolean {
  return slot.kind === c.kind && (c.kind !== 'bot' || slot.difficulty === c.difficulty);
}

export function openSlotChooser(slot: SlotView): void {
  const choose = (c: SlotChoice) => {
    if (!isCurrent(slot, c) && !net.send({ type: 'set_slot', slot: slot.slot, kind: c.kind, difficulty: c.difficulty })) {
      toast('Not connected. Try again in a moment.', 'error');
    }
    dialog.close();
  };
  const buttons = CHOICES.map((c) => {
    const btn = button(c.label, () => choose(c), { variant: isCurrent(slot, c) ? 'primary' : 'secondary' });
    btn.classList.add('nav-item', 'slot-choice');
    if (isCurrent(slot, c)) btn.setAttribute('aria-current', 'true');
    return btn;
  });
  const dialog = modal({
    title: `Slot P${slot.slot + 1}`,
    body: h('div', { class: 'slot-choices' }, buttons),
    actions: [{ label: 'Cancel', variant: 'ghost', hotkey: 'Escape' }],
  });
  (buttons.find((b) => b.getAttribute('aria-current')) ?? buttons[0]).focus();
}
