// Remote soaks are shown on the remote render clock. Events are applied to the worlds the moment
// they arrive, but remote critters are drawn from interpolation, INTERP_DELAY_MS plus the network
// lateness in the past. Shown on arrival, a remote critter running into a splash would vanish,
// and its puddle appear, short of the water it never visibly touched. Held until the render clock
// reaches the soak tick, the critter keeps running on screen, reaches the water and turns into a
// puddle where the server soaked it. The round_over such a soak decides is held behind it, so
// the round is not called before the deciding soak is seen.
import { CONFIG, type GameEvent } from '@splash/shared';

/** An event whose presentation waited for the remote render clock. */
export interface HeldEvent {
  ev: GameEvent;
  /** Server tick the event happened on. */
  tick: number;
}

/**
 * A held event is shown after this long even if the render clock never gets there (snapshots
 * stalled, or a forfeit ended the match and they stopped).
 */
const HOLD_MAX_MS = CONFIG.INTERP_DELAY_MS + 300;

export class RemoteEventHold {
  private queue: (HeldEvent & { atMs: number })[] = [];

  /** Holds `ev` if it is a remote player's soak, or the round_over behind a held soak. */
  hold(ev: GameEvent, tick: number, mySlot: number, nowMs: number): boolean {
    const remoteSoak = ev.type === 'player_soaked' && ev.slot !== mySlot;
    const behindSoak = ev.type === 'round_over' && this.queue.length > 0;
    if (!remoteSoak && !behindSoak) return false;
    this.queue.push({ ev, tick, atMs: nowMs });
    return true;
  }

  /** Is a soak of `slot` still held? Its critter is drawn dry until the soak is shown. */
  holdsSoakOf(slot: number): boolean {
    return this.queue.some((h) => h.ev.type === 'player_soaked' && h.ev.slot === slot);
  }

  /** Held events now due, in arrival order: their tick reached by `renderTick`, or held too long. */
  release(renderTick: number, nowMs: number): HeldEvent[] {
    let n = 0;
    while (n < this.queue.length && (this.queue[n].tick <= renderTick || nowMs - this.queue[n].atMs >= HOLD_MAX_MS)) n++;
    return this.queue.splice(0, n).map(({ ev, tick }) => ({ ev, tick }));
  }

  clear(): void {
    this.queue = [];
  }
}
