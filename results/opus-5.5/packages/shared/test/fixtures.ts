// Test fixtures: build round states from ASCII art and drive players through simulateTick.
import { CONFIG, speedUnitsPerTick } from '../src/config';
import { idx, tileCenter } from '../src/grid';
import type { GeneratedMap } from '../src/map';
import { simulateTick } from '../src/sim';
import { createRoundState, makeRules, spawnBalloon } from '../src/state';
import {
  Dir,
  PowerUp,
  Tile,
  type Balloon,
  type DirCode,
  type GameEvent,
  type PlayerInput,
  type PlayerState,
  type PowerUpKind,
  type RoundState,
  type SimRules,
} from '../src/types';

/**
 * ASCII legend:
 *   '#' boulder     '.' floor     'C' empty castle
 *   'B' 'R' 'S' 'K' castle hiding Balloon / Range / Speed / Boots
 *   'b' 'r' 's' 'k' exposed item of that kind lying on floor
 *   '0'..'3'        floor with that slot's spawn
 */
const HIDDEN: Record<string, PowerUpKind> = { B: PowerUp.Balloon, R: PowerUp.Range, S: PowerUp.Speed, K: PowerUp.Boots };
const EXPOSED: Record<string, PowerUpKind> = { b: PowerUp.Balloon, r: PowerUp.Range, s: PowerUp.Speed, k: PowerUp.Boots };

export interface AsciiMap {
  map: GeneratedMap;
  items: { x: number; y: number; kind: PowerUpKind }[];
}

export function mapFromAscii(rows: string[]): AsciiMap {
  const h = rows.length;
  const w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  const hidden = new Uint8Array(w * h);
  const spawns: GeneratedMap['spawns'] = [];
  const items: AsciiMap['items'] = [];
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`row ${y} has length ${row.length}, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const i = idx(w, x, y);
      if (ch === '#') tiles[i] = Tile.Boulder;
      else if (ch === 'C' || ch in HIDDEN) tiles[i] = Tile.Castle;
      if (ch in HIDDEN) hidden[i] = HIDDEN[ch];
      if (ch in EXPOSED) items.push({ x, y, kind: EXPOSED[ch] });
      if (ch >= '0' && ch <= '3') spawns.push({ slot: Number(ch), tx: x, ty: y });
    }
  });
  spawns.sort((a, b) => a.slot - b.slot);
  return { map: { w, h, tiles, hidden, spawns }, items };
}

export interface StateOpts {
  rules?: Partial<SimRules>;
  /** Defaults to every slot that has a spawn in the art. */
  present?: boolean[];
}

export function stateFromAscii(rows: string[], opts: StateOpts = {}): RoundState {
  const { map, items } = mapFromAscii(rows);
  const maxSlot = map.spawns.reduce((m, sp) => Math.max(m, sp.slot), -1);
  const present = opts.present ?? Array.from({ length: maxSlot + 1 }, (_, slot) => map.spawns.some((sp) => sp.slot === slot));
  const rules = { ...makeRules({ ranked: false }), ...opts.rules };
  const s = createRoundState(map, present, rules);
  for (const it of items) s.items[idx(map.w, it.x, it.y)] = it.kind;
  return s;
}

export function inp(dir: DirCode, balloon = false): PlayerInput {
  return { seq: 0, dir, balloon };
}

/** Puts a stationary balloon on a tile; `fuse` ticks until it bursts (default FUSE_TICKS). */
export function putBalloon(
  s: RoundState,
  tx: number,
  ty: number,
  owner: number,
  opts: { fuse?: number; range?: number; fromDuck?: boolean } = {},
): Balloon {
  return spawnBalloon(s, {
    owner,
    tx,
    ty,
    burstTick: s.tick + (opts.fuse ?? CONFIG.FUSE_TICKS),
    range: opts.range ?? CONFIG.RANGE_BASE,
    fromDuck: opts.fromDuck ?? false,
  });
}

/** Teleports a player to the center of a tile. */
export function placePlayer(s: RoundState, slot: number, tx: number, ty: number): PlayerState {
  const p = s.players[slot];
  p.x = tileCenter(tx);
  p.y = tileCenter(ty);
  return p;
}

export function tileAt(s: RoundState, x: number, y: number): number {
  return s.tiles[idx(s.w, x, y)];
}

export function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Runs `ticks` ticks with the given per-slot inputs (null = idle) and returns all events. */
export function runTicks(s: RoundState, ticks: number, inputs: (PlayerInput | null)[] = []): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...simulateTick(s, inputs));
  return events;
}

/** Runs ticks with the given inputs until `done()` holds; throws after `maxTicks`. Returns all events. */
export function runUntil(
  s: RoundState,
  done: () => boolean,
  inputs: (PlayerInput | null)[] = [],
  maxTicks = 200,
): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; !done(); t++) {
    if (t >= maxTicks) throw new Error(`runUntil: condition not reached within ${maxTicks} ticks`);
    events.push(...simulateTick(s, inputs));
  }
  return events;
}

/**
 * Direction that brings a player closer to a tile center (x first, then y), or None once within
 * half a step of it on both axes (movement is quantized to whole speed steps per tick).
 */
function dirToward(p: PlayerState, tx: number, ty: number): DirCode {
  const tolerance = speedUnitsPerTick(p.speedUps) / 2;
  const dx = tileCenter(tx) - p.x;
  const dy = tileCenter(ty) - p.y;
  if (Math.abs(dx) > tolerance) return dx > 0 ? Dir.Right : Dir.Left;
  if (Math.abs(dy) > tolerance) return dy > 0 ? Dir.Down : Dir.Up;
  return Dir.None;
}

/**
 * Walks `slot` through axis-aligned waypoints (tile coords) with simulateTick, other slots idle,
 * ending each leg within half a step of the waypoint center. Throws if a leg takes > maxTicks.
 */
export function walkPath(s: RoundState, slot: number, waypoints: [number, number][], maxTicks = 200): GameEvent[] {
  const events: GameEvent[] = [];
  for (const [tx, ty] of waypoints) {
    for (let t = 0; ; t++) {
      const dir = dirToward(s.players[slot], tx, ty);
      if (dir === Dir.None) break;
      if (t >= maxTicks) throw new Error(`walkPath: slot ${slot} stuck before (${tx},${ty})`);
      const inputs: (PlayerInput | null)[] = [];
      inputs[slot] = inp(dir);
      events.push(...simulateTick(s, inputs));
    }
  }
  return events;
}

/** Presses the balloon key for one tick (no movement). */
export function dropBalloon(s: RoundState, slot: number): GameEvent[] {
  const inputs: (PlayerInput | null)[] = [];
  inputs[slot] = inp(Dir.None, true);
  return simulateTick(s, inputs);
}
