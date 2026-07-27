/**
 * Settings: audio, accessibility, keybinds, nickname and the device-token
 * account note. Every change is applied and persisted the moment it is made, so
 * there is no Save button except for the nickname, which the server must accept.
 */

import { CONFIG, displayName, validateNickname } from '@splash/shared';
import { applyVolumes, playSfx } from '../audio';
import { on, send } from '../net';
import { navigate, type Screen } from '../router';
import {
  ACTION_LABELS,
  actionForCode,
  clearDeviceToken,
  getSettings,
  onSettingsChange,
  resetKeybinds,
  updateSettings,
  type ActionId,
} from '../settings';
import { getState, subscribe } from '../store';
import { button, el, panel, screenShell } from '../ui/dom';

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
};

/** Turns a KeyboardEvent.code into something a player recognises. */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return `Arrow ${code.slice(5)}`;
  return NAMED_KEYS[code] ?? code;
}

function volumeSlider(
  label: string,
  value: number,
  onChange: (next: number) => void,
  /** Fired when the player lets go, so a preview blip does not machine-gun. */
  onCommit?: () => void,
): HTMLElement {
  const readout = el('span', { class: 'badge', text: `${Math.round(value * 100)}%` });
  const input = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: String(Math.round(value * 100)),
    on: {
      input: () => {
        const next = Number(input.value) / 100;
        readout.textContent = `${input.value}%`;
        onChange(next);
      },
      change: () => onCommit?.(),
    },
  });
  input.setAttribute('aria-label', label);
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'spread' }, el('span', { class: 'field-label', text: label }), readout),
    input,
  );
}

function toggle(
  label: string,
  checked: boolean,
  hint: string,
  onChange: (next: boolean) => void,
): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    checked,
    style: { width: 'auto' },
    on: { change: () => onChange(input.checked) },
  });
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'spread' }, el('span', { class: 'field-label', text: label }), input),
    el('span', { class: 'field-hint', text: hint }),
  );
}

export function createSettingsScreen(): Screen {
  const teardown: (() => void)[] = [];

  /** Action currently waiting for a key, or null. */
  let capturing: ActionId | null = null;
  let captureHandler: ((ev: KeyboardEvent) => void) | null = null;
  let conflictNote = '';
  /** True between sending set_nickname and the server's answer. */
  let saving = false;

  const controlsHost = el('div', { class: 'stack' });
  const nickMessage = el('span', { class: 'field-hint', text: '' });
  const nickInput = el('input', {
    type: 'text',
    maxLength: CONFIG.NICKNAME_MAX,
    placeholder: 'Your critter name',
    value: getState().profile?.nickname ?? '',
  });
  const nickCurrent = el('span', { class: 'muted', text: '' });

  function setNickMessage(text: string, bad: boolean): void {
    nickMessage.textContent = text;
    nickMessage.style.color = bad ? 'var(--danger)' : 'var(--ink-dim)';
  }

  function endCapture(): void {
    if (captureHandler) window.removeEventListener('keydown', captureHandler, true);
    captureHandler = null;
    capturing = null;
  }

  function beginCapture(action: ActionId): void {
    endCapture();
    capturing = action;
    conflictNote = '';
    captureHandler = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const code = ev.code;
      endCapture();
      if (code !== 'Escape') {
        // Read the clash before writing, otherwise the new binding is the clash.
        const clash = actionForCode(code);
        updateSettings({ keybinds: { ...getSettings().keybinds, [action]: [code] } });
        conflictNote =
          clash && clash !== action
            ? `${keyLabel(code)} is also bound to ${ACTION_LABELS[clash]}.`
            : '';
      }
      renderControls();
    };
    window.addEventListener('keydown', captureHandler, true);
    renderControls();
  }

  function keybindRow(action: ActionId): HTMLElement {
    const binds = getSettings().keybinds[action] ?? [];
    const bound = binds.length > 0 ? binds.map(keyLabel).join(' / ') : 'Unbound';
    const control =
      capturing === action
        ? button(
            'Press a key',
            () => {
              endCapture();
              renderControls();
            },
            { variant: 'primary' },
          )
        : button('Rebind', () => beginCapture(action), { variant: 'secondary' });
    control.setAttribute('aria-label', `Rebind ${ACTION_LABELS[action]}`);
    return el(
      'div',
      { class: 'spread' },
      el('span', { text: ACTION_LABELS[action] }),
      el(
        'span',
        { class: 'row' },
        el('span', { class: 'badge', text: capturing === action ? 'Listening' : bound }),
        control,
      ),
    );
  }

  function renderControls(): void {
    const actions = Object.keys(ACTION_LABELS) as ActionId[];
    controlsHost.replaceChildren(
      ...actions.map(keybindRow),
      el('span', {
        class: 'field-hint',
        style: { color: conflictNote ? 'var(--gold)' : 'var(--ink-dim)' },
        text: capturing
          ? 'Press any key to bind it. Escape cancels.'
          : conflictNote || 'A rebind replaces every key currently bound to that action.',
      }),
      el(
        'div',
        { class: 'row' },
        button('Reset to defaults', () => {
          endCapture();
          conflictNote = '';
          resetKeybinds();
          renderControls();
        }),
      ),
    );
  }

  function saveNickname(): void {
    const raw = nickInput.value;
    const check = validateNickname(raw);
    if (!check.ok) {
      setNickMessage(check.reason ?? 'That nickname cannot be used.', true);
      return;
    }
    saving = true;
    setNickMessage('Saving...', false);
    send({ t: 'set_nickname', nickname: raw.trim() });
  }

  function syncProfile(): void {
    const profile = getState().profile;
    nickCurrent.textContent = profile
      ? `Playing as ${displayName(profile.nickname, profile.tag)}`
      : 'Not connected yet.';
    if (profile && document.activeElement !== nickInput && nickInput.value.length === 0) {
      nickInput.value = profile.nickname;
    }
  }

  return {
    mount(host: HTMLElement): void {
      const settings = getSettings();
      renderControls();
      syncProfile();

      const muteButton = button(
        '',
        () => {
          updateSettings({ muted: !getSettings().muted });
          applyVolumes();
          syncMute();
        },
        { variant: 'secondary' },
      );
      function syncMute(): void {
        const muted = getSettings().muted;
        muteButton.textContent = muted ? 'Unmute' : 'Mute';
        muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
      }
      syncMute();

      teardown.push(onSettingsChange(syncMute));
      teardown.push(subscribe(syncProfile));
      teardown.push(
        on('profile_update', (msg) => {
          // Profile updates also arrive for XP and cosmetics, so only a save we
          // started gets to claim the field.
          if (!saving) return;
          saving = false;
          setNickMessage(`Saved as ${displayName(msg.profile.nickname, msg.profile.tag)}.`, false);
          nickInput.value = msg.profile.nickname;
        }),
      );
      teardown.push(
        on('error', (msg) => {
          if (!msg.code.startsWith('nickname')) return;
          saving = false;
          setNickMessage(msg.msg, true);
        }),
      );

      host.appendChild(
        screenShell(
          'Settings',
          () => navigate('/menu'),
          panel(
            'Audio',
            volumeSlider(
              'SFX volume',
              settings.sfxVolume,
              (next) => {
                updateSettings({ sfxVolume: next });
                applyVolumes();
              },
              () => playSfx('ui'),
            ),
            volumeSlider('Music volume', settings.musicVolume, (next) => {
              updateSettings({ musicVolume: next });
              applyVolumes();
            }),
            el(
              'div',
              { class: 'row' },
              muteButton,
              el('span', { class: 'field-hint', text: 'M also toggles mute during a match.' }),
            ),
          ),
          panel(
            'Accessibility',
            toggle(
              'Colourblind-safe splashes',
              settings.colorblindSplash,
              'Swaps the blue splash palette for yellow and orange.',
              (next) => updateSettings({ colorblindSplash: next }),
            ),
            toggle(
              'Reduced screen shake',
              settings.reducedShake,
              'Keeps the camera still when balloons burst.',
              (next) => updateSettings({ reducedShake: next }),
            ),
            toggle('Show ping', settings.showPing, 'Displays your latency in the match HUD.', (next) =>
              updateSettings({ showPing: next }),
            ),
          ),
          panel('Controls', controlsHost),
          panel(
            'Nickname',
            nickCurrent,
            el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Nickname' }), nickInput),
            nickMessage,
            el(
              'div',
              { class: 'row' },
              button('Save nickname', saveNickname, { variant: 'primary' }),
              el('span', {
                class: 'field-hint',
                text: `${CONFIG.NICKNAME_MIN} to ${CONFIG.NICKNAME_MAX} characters. Your #tag stays the same.`,
              }),
            ),
          ),
          panel(
            'Account',
            el('p', {
              class: 'muted',
              style: { margin: '0' },
              text:
                'This account lives on this device only. It is identified by a token in local storage, ' +
                'with no email and no password.',
            }),
            el('p', {
              class: 'muted',
              style: { margin: '0' },
              text:
                'Clearing site data, using a private window, or losing this browser profile loses the ' +
                'account, its level and its unlocks. There is no password recovery.',
            }),
            el(
              'div',
              { class: 'row' },
              button(
                'Sign out and start fresh',
                () => {
                  const sure = window.confirm(
                    'Start fresh? This device forgets the current account, including its level and unlocks. ' +
                      'This cannot be undone.',
                  );
                  if (!sure) return;
                  clearDeviceToken();
                  location.reload();
                },
                { variant: 'danger' },
              ),
              el('span', { class: 'field-hint', text: 'Creates a brand new guest critter.' }),
            ),
          ),
        ),
      );
    },

    unmount(): void {
      endCapture();
      for (const off of teardown.splice(0)) off();
    },
  };
}
