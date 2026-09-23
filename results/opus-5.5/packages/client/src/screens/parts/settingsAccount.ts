// Settings tab 3: who you are (nickname#tag, player id), whether this tab is playing as a
// separate guest (only extra tabs are) and the plain truth about accounts: no passwords, the
// account lives in this browser's storage.
import { net } from '../../net';
import { store } from '../../store';
import { button, h, spinner } from '../../ui';
import { nameTag } from './format';
import { openNicknameDialog } from './nicknameDialog';
import type { Scope } from './scope';
import { chip, sectionLabel } from './shell';

/** Only an extra tab needs a word: the main account is the normal case and says nothing. */
function extraTabNote(identitySlot: number): Node[] {
  if (identitySlot === 0) return [];
  return [h('p', { class: 'acct-tab-note', role: 'note' }, 'This tab is playing as a separate guest because another tab has your main account open.')];
}

function accountBody(): Node[] {
  const profile = store.get().profile;
  if (!profile) return [spinner('Connecting')];
  return [
    sectionLabel('Player'),
    h(
      'div',
      { class: 'acct-row' },
      h('span', { class: 'acct-name selectable' }, nameTag(profile.nickname, profile.tag)),
      profile.hasNickname ? null : chip('Guest', 'coral'),
      button('Change nickname', () => openNicknameDialog(), { small: true }),
    ),
    h('div', { class: 'acct-row' }, h('span', { class: 'acct-key' }, 'Player ID'), h('code', { class: 'acct-id selectable' }, profile.id)),
    ...extraTabNote(net.identitySlot),
    h('p', { class: 'muted-note' }, 'Every extra tab open at the same time signs in as its own guest, so you can play yourself on one computer.'),
    sectionLabel('No passwords'),
    h(
      'div',
      { class: 'acct-warning', role: 'note' },
      h('strong', null, 'Your account lives in this browser. '),
      "There is no password or email: a secret token in this browser's storage is your login. Clearing site data, using a private window or losing the token loses the account (level, unlocks and ratings) for good.",
    ),
  ];
}

export function accountSettings(scope: Scope): HTMLElement {
  const el = h('div', { class: 'settings-account' }, ...accountBody());
  scope.add(
    store.subscribe((next, prev) => {
      if (next.profile !== prev.profile) el.replaceChildren(...accountBody());
    }),
  );
  return el;
}
