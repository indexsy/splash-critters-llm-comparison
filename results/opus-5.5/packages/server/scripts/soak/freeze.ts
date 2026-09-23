// Freeze detection: a bot that spends more than FREEZE_TICKS of free time without making progress
// while it could still reach a castle, an exposed power-up or an opponent is frozen. Progress
// means getting at least PROGRESS_TILES tiles (Manhattan) away from where the watch last anchored
// it, so standing still, jittering inside a tile (lane alignment at pillar corners) and
// oscillating between two neighbouring tiles (flip-flopping goals) all count. Free time excludes
// ticks when a splash is pending on or next to the bot's tile: dodging back and forth while an
// opponent pins it down with balloons is not a freeze.
import { CONFIG, PowerUp, Tile, balloonAt, idx, isFlooded, tileOf, type PlayerState, type RoundState } from '@splash/shared';
import { getDangerMap } from '../../src/bots/dangerMap';

/** 10 s of sim time. */
export const FREEZE_TICKS = 10 * CONFIG.TICK_RATE;
/** Tiles a bot must move away from its anchor for the watch to count progress. */
export const PROGRESS_TILES = 2;
/** A splash due within this many ticks on or next to the bot's tile means it is under threat. */
const THREAT_TICKS = CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS;

export interface FreezeEvent {
  slot: number;
  tick: number;
  x: number;
  y: number;
  reason: string;
}

function tileOfPlayer(s: RoundState, p: PlayerState): number {
  return idx(s.w, tileOf(p.x), tileOf(p.y));
}

/** Tile walk (splashes ignored, flooded tiles excluded): is there anything worth moving for? */
function reachableWork(s: RoundState, slot: number): string | null {
  const start = tileOfPlayer(s, s.players[slot]);
  const seen = new Uint8Array(s.w * s.h);
  const queue = [start];
  seen[start] = 1;
  const opponents = new Set<number>();
  for (const o of s.players) {
    if (o.present && o.alive && o.slot !== slot) opponents.add(tileOfPlayer(s, o));
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    if (s.items[t] !== PowerUp.None) return 'power-up';
    if (t !== start && opponents.has(t)) return 'opponent';
    const x = t % s.w;
    const y = (t - x) / s.w;
    for (const [nx, ny] of [
      [x, y - 1],
      [x, y + 1],
      [x - 1, y],
      [x + 1, y],
    ]) {
      if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
      const n = idx(s.w, nx, ny);
      if (seen[n] === 1 || isFlooded(s, nx, ny)) continue;
      seen[n] = 1;
      if (s.tiles[n] === Tile.Castle) return 'castle';
      if (s.tiles[n] !== Tile.Floor || balloonAt(s, nx, ny) !== undefined) continue;
      queue.push(n);
    }
  }
  return null;
}

function tileDistance(w: number, a: number, b: number): number {
  const ax = a % w;
  const bx = b % w;
  return Math.abs(ax - bx) + Math.abs((a - ax) / w - (b - bx) / w);
}

/** Is a splash (or the tide) due soon on the tile or one of its neighbours? */
function underThreat(s: RoundState, tile: number): boolean {
  const danger = getDangerMap(s);
  const x = tile % s.w;
  const soon = s.tick + THREAT_TICKS;
  for (const n of [tile, tile - s.w, tile + s.w, x > 0 ? tile - 1 : -1, x < s.w - 1 ? tile + 1 : -1]) {
    if (n >= 0 && n < s.w * s.h && danger.firstWetFrom(n, s.tick + 1) <= soon) return true;
  }
  return false;
}

/** Watches the present players of one round (by default all of them). */
export class FreezeWatch {
  private readonly anchor: number[];
  /** Unthreatened ticks spent near the anchor. */
  private readonly free: number[];
  private readonly flagged: boolean[];
  readonly events: FreezeEvent[] = [];

  /** `watched`: per slot, whether to watch it (the passive tutorial bot stands its ground by design). */
  constructor(
    s: RoundState,
    private readonly watched: readonly boolean[] = s.players.map(() => true),
  ) {
    this.anchor = s.players.map((p) => tileOfPlayer(s, p));
    this.free = s.players.map(() => 0);
    this.flagged = s.players.map(() => false);
  }

  observe(s: RoundState): void {
    for (const p of s.players) {
      if (!p.present || !p.alive || !this.watched[p.slot]) continue;
      const tile = tileOfPlayer(s, p);
      if (tileDistance(s.w, tile, this.anchor[p.slot]) >= PROGRESS_TILES) {
        this.anchor[p.slot] = tile;
        this.free[p.slot] = 0;
        this.flagged[p.slot] = false;
        continue;
      }
      if (this.flagged[p.slot] || underThreat(s, tile)) continue;
      if (++this.free[p.slot] <= FREEZE_TICKS) continue;
      const reason = reachableWork(s, p.slot);
      if (reason === null) continue;
      this.flagged[p.slot] = true;
      this.events.push({ slot: p.slot, tick: s.tick, x: p.x, y: p.y, reason });
    }
  }
}
