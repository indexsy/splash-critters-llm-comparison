// Per-round record of every balloon action (placements, revenge lobs, kicks) and the facts the
// soak needs about each soak: who seeded the fatal cascade, and for a self-soak the tick from
// which it is judged (the cut: the victim's last balloon placed into that cascade, or, for a
// cascade the victim's lingering splash set off, its earliest balloon) and the tick of the last
// opponent balloon action from the cut until the soak.
import { splashTiles, type GameEvent } from '@splash/shared';

type SoakedEvent = Extract<GameEvent, { type: 'player_soaked' }>;
type BurstEvent = Extract<GameEvent, { type: 'balloon_burst' }>;

interface BalloonAction {
  tick: number;
  slot: number;
}

export interface SoakFacts {
  /** Owner of the balloon that seeded the cascade whose splash soaked the player (-1 = tide). */
  seedOwner: number;
  /**
   * Self-soaks: placement tick of the victim's latest balloon in the fatal cascade; if it had none
   * there (its lingering splash set the cascade off), of the cascade's earliest balloon.
   */
  cut: number;
  /** Self-soaks: tick of the last opponent balloon action in [cut, soak tick], -1 if none. */
  lastOpponentAction: number;
}

function covers(e: BurstEvent, soaked: SoakedEvent): boolean {
  return splashTiles(e.x, e.y, e.arms).some((t) => t.x === soaked.x && t.y === soaked.y);
}

export class BalloonLog {
  private readonly actions: BalloonAction[] = [];
  private readonly placedAt = new Map<number, number>();

  /** Feeds the events of the tick that has just been simulated (the state's tick is now `tick`). */
  observe(tick: number, events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'balloon_placed') {
        this.placedAt.set(e.id, tick);
        this.actions.push({ tick, slot: e.owner });
      } else if (e.type === 'revenge_lob') {
        this.placedAt.set(e.id, tick);
        this.actions.push({ tick, slot: e.slot });
      } else if (e.type === 'balloon_kicked') {
        this.actions.push({ tick, slot: e.slot });
      }
    }
  }

  /** Facts about a soak, from the events of the tick it happened in. */
  factsOf(events: GameEvent[], soaked: SoakedEvent, tick: number): SoakFacts {
    if (soaked.cause === 'tide') return { seedOwner: -1, cut: tick, lastOpponentAction: -1 };
    const bursts = events.filter((e): e is BurstEvent => e.type === 'balloon_burst');
    const owners = new Map(bursts.map((e) => [e.id, e.owner]));
    const fatal = new Set(bursts.filter((e) => covers(e, soaked)).map((e) => e.chainId));
    const lastChain = [...bursts].reverse().find((e) => covers(e, soaked))?.chainId;
    const seedOwner = lastChain !== undefined ? (owners.get(lastChain) ?? soaked.by) : soaked.by;
    if (soaked.by !== soaked.slot) return { seedOwner, cut: tick, lastOpponentAction: -1 };
    let cut = -1;
    let earliest = tick;
    for (const e of bursts) {
      if (!fatal.has(e.chainId)) continue;
      const placed = this.placedAt.get(e.id) ?? -1;
      if (e.owner === soaked.slot && !e.fromDuck) cut = Math.max(cut, placed);
      if (placed >= 0) earliest = Math.min(earliest, placed);
    }
    if (cut < 0) cut = earliest;
    let lastOpponentAction = -1;
    for (const a of this.actions) {
      if (a.slot !== soaked.slot && a.tick >= cut && a.tick <= tick) lastOpponentAction = Math.max(lastOpponentAction, a.tick);
    }
    return { seedOwner, cut, lastOpponentAction };
  }
}
