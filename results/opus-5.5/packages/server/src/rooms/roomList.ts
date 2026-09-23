// Live public room list for the browser screen: watchers get the full list right away and then
// at most two pushes per second, only when something listed actually changed.
import type { RoomSummary } from '@splash/shared';
import type { Outbox } from '../net/outbox';

const MIN_PUSH_INTERVAL_MS = 500;

export class RoomListFeed {
  private readonly watchers = new Set<string>();
  private dirty = false;
  private lastPushAt = -Infinity;

  constructor(
    private readonly outbox: Outbox,
    private readonly build: () => RoomSummary[],
  ) {}

  watch(playerId: string, on: boolean): void {
    if (!on) {
      this.watchers.delete(playerId);
      return;
    }
    this.watchers.add(playerId);
    this.outbox.send(playerId, { type: 'room_list', rooms: this.build() });
  }

  unwatch(playerId: string): void {
    this.watchers.delete(playerId);
  }

  /** Something visible in the list changed; the next eligible tick pushes it. */
  changed(): void {
    this.dirty = true;
  }

  tick(now: number): void {
    if (!this.dirty || now - this.lastPushAt < MIN_PUSH_INTERVAL_MS) return;
    this.dirty = false;
    if (this.watchers.size === 0) return;
    this.lastPushAt = now;
    const rooms = this.build();
    for (const playerId of this.watchers) this.outbox.send(playerId, { type: 'room_list', rooms });
  }
}
