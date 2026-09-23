// Nickname dialog: 3-16 characters, checked locally for length and by the server for
// profanity and uniqueness; server errors (nickname_invalid / nickname_taken) show inline.
import { CONFIG } from '@splash/shared';
import { net } from '../../net';
import { store } from '../../store';
import { h, modal, textInput, toast } from '../../ui';
import { nicknameProblem } from './format';
import { modalButton, setPending } from './form';
import { awaitServerReply, errorText } from './serverReply';

export interface NicknameDialogOptions {
  /** Why the dialog opened (e.g. "Ranked play needs your own nickname."). */
  reason?: string;
  onSaved?: () => void;
}

export function openNicknameDialog(opts: NicknameDialogOptions = {}): void {
  const profile = store.get().profile;
  if (!profile) {
    toast('Still connecting to the server', 'warn');
    return;
  }
  let cancelReply: (() => void) | null = null;
  const error = h('div', { class: 'error-line', role: 'alert' });
  const counter = h('span', { class: 'nick-counter' });
  const input = textInput({
    label: 'Nickname',
    placeholder: 'Your nickname',
    value: profile.hasNickname ? profile.nickname : '',
    maxLength: CONFIG.NICK_MAX,
    autofocus: true,
    onInput: (v) => {
      error.textContent = '';
      renderCounter(v);
    },
    onEnter: () => submit(),
  });
  const renderCounter = (v: string) => {
    counter.textContent = `${v.trim().length}/${CONFIG.NICK_MAX}`;
    counter.classList.toggle('danger', v.trim().length > 0 && nicknameProblem(v) !== null);
  };
  renderCounter(input.value);

  const body = h(
    'div',
    { class: 'col nick-body' },
    opts.reason ? h('p', { class: 'nick-reason' }, opts.reason) : null,
    h('div', { class: 'nick-field' }, input, counter),
    error,
    h('p', { class: 'muted-note' }, `${CONFIG.NICK_MIN}-${CONFIG.NICK_MAX} characters. Your #${profile.tag} tag keeps it unique.`),
  );

  const dialog = modal({
    title: profile.hasNickname ? 'Change nickname' : 'Pick a nickname',
    body,
    onClose: () => cancelReply?.(),
    actions: [
      { label: 'Save', variant: 'primary', onClick: () => (submit(), false) },
      { label: 'Cancel', variant: 'ghost', hotkey: 'Escape' },
    ],
  });
  const saveBtn = modalButton(dialog.el, 0);

  function submit(): void {
    if (cancelReply) return;
    const nickname = input.value.trim();
    const problem = nicknameProblem(nickname);
    if (problem) {
      error.textContent = problem;
      input.focus();
      return;
    }
    const current = store.get().profile;
    if (current?.hasNickname && current.nickname === nickname) {
      dialog.close();
      opts.onSaved?.();
      return;
    }
    if (!net.send({ type: 'set_nickname', nickname })) {
      error.textContent = 'Not connected. Try again in a moment.';
      return;
    }
    setPending(saveBtn, true, 'Saving...');
    cancelReply = awaitServerReply({
      errors: ['nickname_invalid', 'nickname_taken'],
      succeeded: (next, prev) => {
        const [now, before] = [next.profile, prev.profile];
        if (!now || now === before || !now.hasNickname) return false;
        return !before?.hasNickname || now.nickname !== before.nickname || now.tag !== before.tag;
      },
      onSuccess: () => {
        cancelReply = null;
        dialog.close();
        toast(`You are now ${store.get().profile?.nickname ?? nickname}`, 'success');
        opts.onSaved?.();
      },
      onError: (err) => {
        cancelReply = null;
        setPending(saveBtn, false);
        error.textContent = errorText(err);
        input.focus();
        input.select();
      },
    });
  }
}
