// Scripted tutorial lessons: step texts, progress detection from sim events, and the sandbox
// safety net that re-supplies a power-up if the map ran out before lesson 3.
import { CONFIG, DIR_DX, DIR_DY, ALL_DIRS, PowerUp, Tile, idx, isSolidFor, tileOf } from '@splash/shared';
import type { GameEvent, RoundState } from '@splash/shared';

export const TUTORIAL_TOTAL = 5;
/** Tiles the player must walk for lesson 1. */
const WALK_GOAL = 3;

export const TUTORIAL_STEPS: readonly { title: string; text: string }[] = [
  { title: 'Waddle around', text: 'Walk a few tiles with WASD or the arrow keys.' },
  {
    title: 'Splash a sandcastle',
    text: 'Stand next to a sandcastle, drop a balloon with Space, then step out of its line before it bursts.',
  },
  { title: 'Grab a power-up', text: 'Washed castles can hide power-ups. Walk over one to collect it.' },
  { title: 'Chain splash', text: 'Drop two balloons in a line. When one bursts, its splash sets off the other!' },
  { title: 'Soak the bot', text: 'Catch the bot in one of your splashes to finish the tutorial.' },
];

type Lesson = 'dodge' | 'powerup' | 'chain';

/**
 * Tracks lesson progress from each tick's state + events. Lessons 2-4 are latched whenever they
 * happen (so an early power-up grab never soft-locks lesson 3); lesson 5 only counts once reached.
 */
export class TutorialProgress {
  /** Current lesson 1..TUTORIAL_TOTAL; TUTORIAL_TOTAL + 1 once complete. */
  step = 1;
  private tilesWalked = 0;
  private lastTile = -1;
  /** Tick at which the castle-washing burst's splash is gone (the dodge succeeded), -1 when none pending. */
  private dodgeUntil = -1;
  private botSoaked = false;
  private readonly learned = new Set<Lesson>();

  constructor(
    private readonly playerSlot: number,
    private readonly botSlot: number,
  ) {}

  get complete(): boolean {
    return this.step > TUTORIAL_TOTAL;
  }

  /** Feeds one simulated tick; returns true when the current lesson changed. */
  observe(state: RoundState, events: readonly GameEvent[]): boolean {
    this.trackWalking(state);
    for (const e of events) this.trackEvent(state, e);
    this.resolveDodge(state);
    const before = this.step;
    while (!this.complete && this.stepDone()) this.step++;
    return this.step !== before;
  }

  private trackWalking(state: RoundState): void {
    const p = state.players[this.playerSlot];
    if (!p.alive) {
      this.lastTile = -1;
      return;
    }
    const tile = idx(state.w, tileOf(p.x), tileOf(p.y));
    if (this.lastTile >= 0 && tile !== this.lastTile) this.tilesWalked++;
    this.lastTile = tile;
  }

  private trackEvent(state: RoundState, e: GameEvent): void {
    if (e.type === 'castle_washed' && e.by === this.playerSlot && !this.learned.has('dodge')) {
      this.dodgeUntil = state.tick + CONFIG.SPLASH_TICKS;
    } else if (e.type === 'player_soaked' && e.slot === this.playerSlot) {
      this.dodgeUntil = -1;
    } else if (e.type === 'powerup_collected' && e.slot === this.playerSlot) {
      this.learned.add('powerup');
    } else if (e.type === 'chain_burst' && e.owner === this.playerSlot && e.count >= 2) {
      this.learned.add('chain');
    } else if (e.type === 'player_soaked' && e.slot === this.botSlot && e.by === this.playerSlot && this.step === TUTORIAL_TOTAL) {
      this.botSoaked = true;
    }
  }

  private resolveDodge(state: RoundState): void {
    if (this.dodgeUntil < 0 || state.tick < this.dodgeUntil) return;
    if (state.players[this.playerSlot].alive) this.learned.add('dodge');
    this.dodgeUntil = -1;
  }

  private stepDone(): boolean {
    switch (this.step) {
      case 1:
        return this.tilesWalked >= WALK_GOAL;
      case 2:
        return this.learned.has('dodge');
      case 3:
        return this.learned.has('powerup');
      case 4:
        return this.learned.has('chain');
      default:
        return this.botSoaked;
    }
  }
}

function anyPowerUpLeft(state: RoundState): boolean {
  for (let i = 0; i < state.items.length; i++) {
    if (state.items[i] !== PowerUp.None) return true;
    if (state.tiles[i] === Tile.Castle && state.hidden[i] !== PowerUp.None) return true;
  }
  return false;
}

/** Nearest walkable, empty, dry tile at least one step from the player (BFS), else the player's own tile. */
function powerUpSpot(state: RoundState, slot: number): { x: number; y: number } {
  const p = state.players[slot];
  const start = { x: tileOf(p.x), y: tileOf(p.y) };
  const seen = new Set<number>([idx(state.w, start.x, start.y)]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const dir of ALL_DIRS) {
      const x = cur.x + DIR_DX[dir];
      const y = cur.y + DIR_DY[dir];
      const i = idx(state.w, x, y);
      if (seen.has(i) || isSolidFor(state, slot, x, y)) continue;
      seen.add(i);
      if (state.items[i] === PowerUp.None && state.splashUntil[i] <= state.tick) return { x, y };
      queue.push({ x, y });
    }
  }
  return start;
}

/** Lesson 3 safety net: when no power-up is left anywhere, reveal an Extra Balloon near the player. */
export function ensurePowerUpAvailable(state: RoundState, events: GameEvent[], playerSlot: number): void {
  if (anyPowerUpLeft(state) || !state.players[playerSlot].alive) return;
  const spot = powerUpSpot(state, playerSlot);
  state.items[idx(state.w, spot.x, spot.y)] = PowerUp.Balloon;
  events.push({ type: 'powerup_revealed', x: spot.x, y: spot.y, kind: PowerUp.Balloon });
}
