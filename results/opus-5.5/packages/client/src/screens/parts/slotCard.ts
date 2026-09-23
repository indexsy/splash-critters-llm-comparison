// Lobby slot card: the seated critter (or an open / closed placeholder), name#tag, level,
// READY state, host crown, bot difficulty and connection state. Hosts get an EDIT button on
// every non-human slot (open / closed / bot + difficulty).
import { Dir, type SlotView } from '@splash/shared';
import { slotColor } from '../../render/palette';
import { getCritter, getGlyph } from '../../render/sprites';
import { settings } from '../../settings';
import { button, h } from '../../ui';
import { difficultyShort } from './format';
import { navKey } from './refocus';
import { chip } from './shell';
import { spriteEl } from './sprite';

/** Longer names drop a font step so narrow 4-player cards show them whole (up to ~13). */
const SLOT_NAME_FULL_CHARS = 11;

export interface SlotCardOptions {
  slot: SlotView;
  isYou: boolean;
  canEdit: boolean;
  onEdit: (slot: SlotView) => void;
}

function figure(slot: SlotView): HTMLElement {
  const cb = settings.get().colorblind;
  if ((slot.kind === 'human' || slot.kind === 'bot') && slot.animal) {
    return h('div', { class: 'slot-figure' }, spriteEl(getCritter(slot.animal, slot.hat ?? 'none', Dir.Down, 0, slot.slot, cb), 2, 'slot-critter'));
  }
  if (slot.kind === 'closed') return h('div', { class: 'slot-figure slot-figure-closed' }, spriteEl(getGlyph('lock'), 2));
  return h('div', { class: 'slot-figure slot-figure-open' }, h('span', { class: 'slot-q' }, '?'));
}

function statusLine(slot: SlotView): HTMLElement {
  if (slot.kind === 'open') return h('div', { class: 'slot-status is-open' }, 'Open');
  if (slot.kind === 'closed') return h('div', { class: 'slot-status is-closed' }, 'Closed');
  if (slot.kind === 'bot') return h('div', { class: 'slot-status is-bot' }, spriteEl(getGlyph('bot')), `Bot ${difficultyShort(slot.difficulty ?? 'medium')}`);
  if (!slot.connected) return h('div', { class: 'slot-status is-offline blink' }, 'Offline');
  if (slot.isHost) return h('div', { class: 'slot-status is-host' }, 'Host');
  return h('div', { class: `slot-status ${slot.ready ? 'is-ready' : 'is-waiting'}` }, slot.ready ? 'Ready!' : 'Not ready');
}

function nameBlock(slot: SlotView): HTMLElement[] {
  if (slot.kind === 'open') return [h('div', { class: 'slot-name muted' }, 'Waiting'), h('div', { class: 'slot-sub' }, 'for a player')];
  if (slot.kind === 'closed') return [h('div', { class: 'slot-name muted' }, 'No player'), h('div', { class: 'slot-sub' }, ' ')];
  const sub = slot.kind === 'bot' ? 'CPU' : `#${slot.tag ?? '----'}${slot.level ? ` Lv ${slot.level}` : ''}`;
  const name = slot.name ?? 'Player';
  const long = name.length > SLOT_NAME_FULL_CHARS;
  return [h('div', { class: `slot-name${long ? ' is-long' : ''}`, title: name }, name), h('div', { class: 'slot-sub' }, sub)];
}

export function slotCard({ slot, isYou, canEdit, onEdit }: SlotCardOptions): HTMLElement {
  const color = slotColor(slot.slot, settings.get().colorblind);
  const classes = ['slot-card', `kind-${slot.kind}`, isYou ? 'is-you' : '', slot.ready ? 'is-ready' : ''].filter(Boolean).join(' ');
  return h(
    'div',
    { class: classes, style: { '--slot-main': color.main, '--slot-dark': color.dark } },
    h(
      'div',
      { class: 'slot-top' },
      h('span', { class: 'slot-label' }, `P${slot.slot + 1}`),
      isYou ? chip('You', 'sand') : null,
      slot.isHost ? spriteEl(getGlyph('crown'), 1, 'slot-crown') : null,
    ),
    figure(slot),
    ...nameBlock(slot),
    statusLine(slot),
    canEdit ? navKey(button('Edit', () => onEdit(slot), { small: true, variant: 'ghost', title: `Change slot P${slot.slot + 1}` }), `slot-${slot.slot}`) : null,
  );
}
