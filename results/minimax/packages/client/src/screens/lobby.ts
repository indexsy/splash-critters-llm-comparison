import type { RoomState } from '@splash-critters/shared';
import type { App } from '../app.js';
import { button, clear, el, panel } from '../ui.js';

/** The room lobby: slots, host controls and the share link. */
export class LobbyScreen {
  private app: App | null = null;
  private room: RoomState | null = null;
  private body: HTMLDivElement | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    this.body = el('div', {});
    const root = panel('Room', this.body);
    app.overlay.appendChild(root);
    if (app.room) this.setRoom(app.room);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* static */
  }

  setRoom(room: RoomState): void {
    this.room = room;
    const app = this.app;
    if (!app || !this.body) return;
    clear(this.body);
    const profile = app.state.profile;
    const isHost = room.slots.some(
      (slot) => slot.isHost && slot.playerId === app.state.playerId,
    );
    const shareUrl = `${window.location.origin}/#/room/${room.code}`;

    this.body.appendChild(
      el('div', { class: 'spread' }, [
        el('div', {}, [
          el('strong', {}, [room.name]),
          el('span', { class: 'hint' }, [` CODE ${room.code}`]),
        ]),
        el('div', { class: 'row' }, [
          el('span', { class: 'pill' }, [`${room.maxPlayers === 4 ? '4P FFA' : '2P DUEL'}`]),
          el('span', { class: 'pill' }, [String(room.theme)]),
          el('span', { class: 'pill' }, [`${room.roundsToWin} ROUNDS`]),
        ]),
      ]),
    );

    const slots = el('div', { class: 'list' });
    for (const slot of room.slots) {
      const controls = el('div', { class: 'row' });
      if (isHost && slot.kind !== 'human') {
        controls.appendChild(
          button('Easy bot', () =>
            app.send({ t: 'set_slot', slot: slot.index, kind: 'bot', difficulty: 'easy' }),
          ),
        );
        controls.appendChild(
          button('Med bot', () =>
            app.send({ t: 'set_slot', slot: slot.index, kind: 'bot', difficulty: 'medium' }),
          ),
        );
        controls.appendChild(
          button('Hard bot', () =>
            app.send({ t: 'set_slot', slot: slot.index, kind: 'bot', difficulty: 'hard' }),
          ),
        );
        controls.appendChild(
          button('Empty', () => app.send({ t: 'set_slot', slot: slot.index, kind: 'empty' })),
        );
      }
      slots.appendChild(
        el('div', { class: 'item' }, [
          el('div', { class: 'col' }, [
            el('strong', {}, [
              `Slot ${slot.index + 1}: `,
              slot.kind === 'empty'
                ? 'empty'
                : slot.kind === 'bot'
                  ? `${slot.difficulty ?? 'medium'} bot`
                  : `${slot.nickname}#${slot.tag}`,
              slot.isHost ? ' (host)' : '',
            ]),
            el('span', { class: 'hint' }, [
              slot.kind === 'human'
                ? slot.connected
                  ? 'connected'
                  : 'disconnected - grace timer running'
                : slot.kind === 'bot'
                  ? 'server side bot'
                  : 'waiting for a player',
            ]),
          ]),
          controls,
        ]),
      );
    }
    this.body.appendChild(slots);

    this.body.appendChild(
      el('div', { class: 'row' }, [
        button('Copy invite link', async () => {
          try {
            await navigator.clipboard.writeText(shareUrl);
            app.toast('invite link copied');
          } catch {
            app.toast(shareUrl);
          }
        }),
        button('Refresh', () => app.send({ t: 'room_list_request' })),
        button('Leave room', () => {
          app.send({ t: 'leave_room' });
          app.go('menu');
        }),
        isHost
          ? button('Start match', () => app.send({ t: 'start_match' }), 'primary')
          : el('span', { class: 'hint' }, ['waiting for the host to start…']),
      ]),
    );
    if (profile) {
      this.body.appendChild(
        el('p', { class: 'hint' }, ['Share the code so friends can join: ' + room.code]),
      );
    }
  }
}
