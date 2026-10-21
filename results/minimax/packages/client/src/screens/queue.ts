import type { App } from '../app.js';
import { button, clear, el, panel } from '../ui.js';

/** Ranked matchmaking screen. */
export class QueueScreen {
  private app: App | null = null;
  private statusNode: HTMLDivElement | null = null;
  private timer = 0;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    this.statusNode = el('div', { class: 'card' });
    const root = panel(
      'Finding a match',
      this.statusNode,
      el('div', { class: 'row' }, [
        button('Cancel', () => app.leaveQueue()),
      ]),
      el('p', { class: 'hint' }, ['Ranked matches never use bots. Ratings are per mode.']),
    );
    app.overlay.appendChild(root);
    this.renderStatus();
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(dt: number): void {
    this.timer += dt;
    this.renderStatus();
  }

  private renderStatus(): void {
    const app = this.app;
    if (!app || !this.statusNode) return;
    const queue = app.state.queue;
    clear(this.statusNode);
    if (!queue) {
      this.statusNode.appendChild(el('span', {}, ['Connecting to the queue…']));
      return;
    }
    const seconds = Math.floor(queue.elapsedMs / 1000);
    this.statusNode.appendChild(
      el('div', { class: 'spread' }, [
        el('span', {}, [queue.mode === 'duel' ? 'Ranked duel' : 'Ranked free-for-all']),
        el('span', { class: 'hint' }, [`${seconds}s`]),
      ]),
    );
    this.statusNode.appendChild(
      el('div', { class: 'spread' }, [
        el('span', { class: 'hint' }, ['search range']),
        el('span', {}, [`±${queue.searchRange}`]),
      ]),
    );
    this.statusNode.appendChild(
      el('div', { class: 'spread' }, [
        el('span', { class: 'hint' }, ['players in queue']),
        el('span', {}, [String(queue.queued)]),
      ]),
    );
  }
}
