import type { RoomInfo } from '@splash-critters/shared';
import type { App } from '../app.js';
import { button, clear, el, panel } from '../ui.js';

/** Public room browser. */
export class BrowserScreen {
  private app: App | null = null;
  private rooms: RoomInfo[] = [];
  private filter: 'all' | 'duel' | 'ffa' = 'all';
  private listNode: HTMLDivElement | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    this.listNode = el('div', { class: 'list' });
    const root = panel(
      'Public rooms',
      el('div', { class: 'row' }, [
        button('All', () => this.setFilter('all')),
        button('Duels', () => this.setFilter('duel')),
        button('Free-for-all', () => this.setFilter('ffa')),
        button('Refresh', () => this.refresh()),
        button('Create room', () => app.go('menu')),
        button('Back', () => app.go('menu')),
      ]),
      this.listNode,
    );
    app.overlay.appendChild(root);
    this.refresh();
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* static */
  }

  private setFilter(filter: 'all' | 'duel' | 'ffa'): void {
    this.filter = filter;
    this.refresh();
  }

  private refresh(): void {
    const app = this.app;
    if (!app) return;
    app.send({ t: 'room_list_request', mode: this.filter === 'all' ? undefined : this.filter });
    setTimeout(() => this.renderRooms(), 120);
  }

  private renderRooms(): void {
    const app = this.app;
    if (!app || !this.listNode) return;
    clear(this.listNode);
    if (this.rooms.length === 0) {
      this.listNode.appendChild(
        el('div', { class: 'muted' }, ['No open rooms right now - create one!']),
      );
      return;
    }
    for (const room of this.rooms) {
      this.listNode.appendChild(
        el('div', { class: 'item' }, [
          el('div', { class: 'col' }, [
            el('strong', {}, [room.name]),
            el('span', { class: 'hint' }, [
              `${room.maxPlayers === 4 ? '4P FFA' : '2P DUEL'} - ${room.theme} - ${room.roundsToWin} rounds - host ${room.host}`,
            ]),
          ]),
          el('div', { class: 'row' }, [
            el('span', { class: 'pill' }, [`${room.players}/${room.maxPlayers}`]),
            button('Join', () => {
              app.send({ t: 'join_room', code: room.code });
              clear(app.overlay);
            }, 'primary'),
          ]),
        ]),
      );
    }
  }

  /** Called by the app when the room list arrives. */
  setRooms(rooms: RoomInfo[]): void {
    this.rooms = rooms;
    this.renderRooms();
  }
}
