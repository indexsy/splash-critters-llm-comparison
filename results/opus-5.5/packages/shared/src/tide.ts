// Rising tide (sudden death): from rules.tideStartTick, one ring floods every
// TIDE_INTERVAL_TICKS, inward from the border. Flooded tiles soak, dissolve castles (their
// hidden item is lost), wash away exposed items and fizzle balloons.
import { CONFIG } from './config';
import { idx, ringIndex } from './grid';
import { PowerUp, Tile, type Balloon, type GameEvent, type PowerUpKind, type RoundState } from './types';

/** Level L floods every tile whose ring index is 1..L (ring 0 is the boulder border). */
export function isFlooded(s: RoundState, tx: number, ty: number): boolean {
  if (s.tideLevel <= 0) return false;
  const ring = ringIndex(s.w, s.h, tx, ty);
  return ring >= 1 && ring <= s.tideLevel;
}

/** Tide level at which every walkable tile is under water. */
export function maxTideLevel(w: number, h: number): number {
  return Math.floor((Math.min(w, h) - 1) / 2);
}

/**
 * Raises the tide one ring and schedules the next rise. Once tideLevel reaches maxTideLevel the
 * arena is fully flooded: this becomes a no-op and nextTideTick is left as is (no further rise).
 */
export function advanceTide(s: RoundState, events: GameEvent[]): void {
  if (s.tideLevel >= maxTideLevel(s.w, s.h)) return;
  s.tideLevel++;
  s.nextTideTick = s.tick + CONFIG.TIDE_INTERVAL_TICKS;
  events.push({ type: 'tide_advance', level: s.tideLevel });
  floodTiles(s, events);
  fizzleFloodedBalloons(s, events);
}

/** Dissolves castles and removes items on every flooded tile (row-major). */
function floodTiles(s: RoundState, events: GameEvent[]): void {
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!isFlooded(s, x, y)) continue;
      const i = idx(s.w, x, y);
      if (s.tiles[i] === Tile.Castle) {
        s.tiles[i] = Tile.Floor;
        s.hidden[i] = PowerUp.None;
        events.push({ type: 'castle_washed', x, y, by: -1 });
      }
      if (s.items[i] !== PowerUp.None) {
        events.push({ type: 'powerup_destroyed', x, y, kind: s.items[i] as PowerUpKind });
        s.items[i] = PowerUp.None;
      }
    }
  }
}

/** Removes balloons resting on (or kicked into) flooded tiles, in id order. */
export function fizzleFloodedBalloons(s: RoundState, events: GameEvent[]): void {
  if (s.tideLevel <= 0) return;
  const kept: Balloon[] = [];
  for (const b of s.balloons) {
    if (isFlooded(s, b.tx, b.ty)) events.push({ type: 'balloon_fizzled', id: b.id, x: b.tx, y: b.ty });
    else kept.push(b);
  }
  if (kept.length !== s.balloons.length) s.balloons = kept;
}
