/**
 * Room lobby for '/room/:code'. It is the only screen a shareable link can drop
 * a stranger into, so it also handles joining the room it is pointed at.
 */

import { displayName, tierForRating, type BotDifficulty, type LobbyState, type SlotInfo } from '@splash/shared';
import { playSfx } from '../audio';
import { on, send } from '../net';
import { drawCritterIcon } from '../render/sprites';
import type { Screen } from '../router';
import { navigate } from '../router';
import { getState, pushToast, subscribe } from '../store';
import { button, el, panel, screenShell } from '../ui/dom';

const LOST_ROOM_ERRORS = new Set(['room_not_found', 'room_full', 'room_in_progress', 'not_in_room']);
const DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];
const ICON_PX = 8;

function shareUrl(code: string): string {
  return `${location.origin}/#/room/${code}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the manual selection path below.
  }
  const holder = el('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
  document.body.appendChild(holder);
  holder.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  holder.remove();
  return ok;
}

/** One portrait per filled slot: an 8x8 sprite blown up 4x by CSS. */
function critterIcon(info: SlotInfo): HTMLCanvasElement {
  const canvas = el('canvas', {
    attrs: { 'aria-hidden': 'true' },
    style: { width: '32px', height: '32px', display: 'block', imageRendering: 'pixelated', flex: '0 0 auto' },
  });
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    // drawCritterIcon centres its 8x8 portrait on the point it is given.
    drawCritterIcon(ctx, { slot: info.slot, animal: info.animal, hat: info.hat }, ICON_PX / 2, ICON_PX / 2);
  }
  return canvas;
}

function occupiedCount(lobby: LobbyState): number {
  return lobby.slots.filter((slot) => slot.kind === 'human' || slot.kind === 'bot').length;
}

export function createLobbyScreen(): Screen {
  let code = '';
  let signature = '';
  /** True once lobby_state for this room has been seen at least once. */
  let joined = false;
  let unsubscribeStore: (() => void) | null = null;
  let unsubscribeError: (() => void) | null = null;
  const botChoice = new Map<number, BotDifficulty>();

  const body = el('div', { class: 'stack' });

  function myInfo(lobby: LobbyState): SlotInfo | null {
    const playerId = getState().playerId;
    if (!playerId) return null;
    return lobby.slots.find((slot) => slot.playerId === playerId) ?? null;
  }

  function leave(): void {
    playSfx('ui_back');
    send({ t: 'leave_room' });
    navigate('/menu');
  }

  function bailToMenu(message: string): void {
    pushToast('error', message);
    navigate('/menu');
  }

  function setSlotBot(slot: number): void {
    playSfx('ui');
    send({ t: 'set_slot', slot, kind: 'bot', difficulty: botChoice.get(slot) ?? 'medium' });
  }

  function clearSlot(slot: number): void {
    playSfx('ui');
    send({ t: 'set_slot', slot, kind: 'open' });
  }

  function difficultySelect(slot: number): HTMLSelectElement {
    const current = botChoice.get(slot) ?? 'medium';
    const node = el(
      'select',
      {
        attrs: { 'aria-label': `Bot difficulty for slot ${slot + 1}` },
        on: {
          change: () => {
            botChoice.set(slot, node.value as BotDifficulty);
          },
        },
      },
      ...DIFFICULTIES.map((id) =>
        el('option', { value: id, text: id.charAt(0).toUpperCase() + id.slice(1) }),
      ),
    );
    node.value = current;
    node.style.width = 'auto';
    return node;
  }

  function slotLabels(lobby: LobbyState, info: SlotInfo): HTMLElement[] {
    const labels: HTMLElement[] = [];
    if (info.slot === lobby.hostSlot) labels.push(el('span', { class: 'badge', text: 'Host' }));
    if (info.playerId && info.playerId === getState().playerId) {
      labels.push(el('span', { class: 'badge', text: 'You' }));
    }
    if (info.kind === 'bot' && info.difficulty) {
      labels.push(el('span', { class: 'badge', text: `Bot - ${info.difficulty}` }));
    }
    if (info.kind === 'human' && !info.connected) {
      labels.push(el('span', { class: 'badge', text: 'Reconnecting' }));
    }
    if (lobby.ranked && info.rating !== null) {
      const tier = tierForRating(info.rating);
      labels.push(el('span', { class: 'badge', text: String(info.rating) }));
      labels.push(el('span', { class: `tier tier-${tier.id}`, text: tier.name }));
    }
    return labels;
  }

  function slotRow(lobby: LobbyState, info: SlotInfo, hostControls: boolean): HTMLElement {
    const filled = info.kind === 'human' || info.kind === 'bot';
    const title = filled
      ? info.kind === 'bot'
        ? info.nickname
        : displayName(info.nickname, info.tag)
      : info.kind === 'closed'
        ? 'Closed slot'
        : 'Open slot';

    const details = el(
      'div',
      { class: 'stack' },
      el('div', { class: 'row' }, el('strong', { text: title }), ...slotLabels(lobby, info)),
      el('span', {
        class: 'muted',
        text: filled
          ? `Level ${info.level} - ${info.ready ? 'Ready' : 'Not ready'}`
          : 'Waiting for a critter',
      }),
    );

    const controls = el('div', { class: 'row' });
    if (hostControls && info.kind === 'open') {
      controls.append(difficultySelect(info.slot), button('Add bot', () => setSlotBot(info.slot)));
    } else if (hostControls && info.kind === 'bot') {
      controls.append(button('Clear slot', () => clearSlot(info.slot), { variant: 'danger' }));
    }

    return el(
      'div',
      { class: 'list-row' },
      el(
        'div',
        { class: 'row' },
        filled ? critterIcon(info) : el('span', { class: 'badge', text: `Slot ${info.slot + 1}` }),
        details,
      ),
      controls,
    );
  }

  function renderJoining(): void {
    body.replaceChildren(
      panel(
        'Joining',
        el('p', { class: 'muted', text: `Asking the server for room ${code}...` }),
        button('Back to menu', () => {
          playSfx('ui_back');
          navigate('/menu');
        }),
      ),
    );
  }

  function renderLobby(lobby: LobbyState): void {
    const mine = myInfo(lobby);
    const isHost = !lobby.ranked && mine !== null && mine.slot === lobby.hostSlot;
    const hostControls = isHost && lobby.phase === 'lobby';
    const occupied = occupiedCount(lobby);

    const codeRow = el(
      'div',
      { class: 'spread' },
      el('span', { class: 'big-number', text: lobby.code }),
      button('Copy link', () => {
        playSfx('ui');
        void copyToClipboard(shareUrl(lobby.code)).then((ok) => {
          if (ok) pushToast('good', 'Invite link copied to your clipboard.');
          else pushToast('info', shareUrl(lobby.code));
        });
      }),
    );

    const actions = el('div', { class: 'row' });
    if (!lobby.ranked) {
      actions.append(
        button(mine?.ready ? 'Cancel ready' : 'Ready up', () => {
          playSfx('ui');
          send({ t: 'set_ready', ready: !mine?.ready });
        }, { variant: mine?.ready ? 'secondary' : 'primary' }),
      );
    }
    if (hostControls) {
      actions.append(
        button('Start match', () => {
          playSfx('ui');
          send({ t: 'start_match' });
        }, {
          variant: 'primary',
          disabled: occupied < 2,
          title: occupied < 2 ? 'At least two slots must be filled.' : 'Start the match',
        }),
      );
    }
    actions.append(button('Leave room', leave, { variant: 'danger' }));

    body.replaceChildren(
      panel(
        lobby.name,
        codeRow,
        el('p', {
          class: 'muted',
          text: `${lobby.mode === 'duel' ? 'Duel' : 'Free-for-All'} - first to ${lobby.roundsToWin} - ${lobby.isPublic ? 'public' : 'private'}${lobby.botFill ? ' - bots fill empty slots' : ''}`,
        }),
        lobby.ranked
          ? el('p', { class: 'field-hint', text: 'Ranked match. Waiting for the match to start.' })
          : el('p', {
              class: 'field-hint',
              text: hostControls
                ? 'You are the host: assign bots, then start when everyone is set.'
                : 'The host decides when the match starts.',
            }),
      ),
      panel('Slots', el('div', { class: 'list' }, ...lobby.slots.map((slot) => slotRow(lobby, slot, hostControls)))),
      panel(
        null,
        actions,
        lobby.phase !== 'lobby'
          ? el('p', { class: 'field-hint', text: 'This room is already playing. Hold on for the results.' })
          : el('p', { class: 'field-hint', text: `${occupied} of ${lobby.slots.length} slots filled.` }),
      ),
    );
  }

  function render(): void {
    const lobby = getState().lobby;
    const matching = lobby && lobby.code === code ? lobby : null;
    const next = matching ? `${getState().playerId ?? ''}|${JSON.stringify(matching)}` : 'joining';
    if (next === signature) return;
    signature = next;
    if (matching) {
      joined = true;
      renderLobby(matching);
      return;
    }
    // The room vanished under us: closed by the host, swept, or we were removed.
    if (joined) {
      bailToMenu('That room is no longer available.');
      return;
    }
    renderJoining();
  }

  return {
    mount(host, params) {
      code = (params.code ?? '').toUpperCase();

      // The header chevron leaves the room outright: staying in a room you have
      // navigated away from only gets you dragged back by the next lobby_state.
      host.appendChild(screenShell('Lobby', () => leave(), body));

      const lobby = getState().lobby;
      if (!lobby || lobby.code !== code) send({ t: 'join_room', code });

      render();
      unsubscribeStore = subscribe(render);
      unsubscribeError = on('error', (msg) => {
        if (LOST_ROOM_ERRORS.has(msg.code)) bailToMenu(msg.msg);
      });
    },

    unmount() {
      unsubscribeStore?.();
      unsubscribeError?.();
      unsubscribeStore = null;
      unsubscribeError = null;
      botChoice.clear();
    },
  };
}
