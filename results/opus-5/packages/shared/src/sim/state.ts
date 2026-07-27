/** Round state construction, cloning and the small grid/entity queries. */

import { CONFIG } from '../config.js';
import { buildTideSchedule, generateMap, idx, spawnPoints } from '../map.js';
import {
  Dir,
  Tile,
  type Balloon,
  type GameMode,
  type GameState,
  type PlayerState,
  type TileValue,
} from '../types.js';

export interface RoundOptions {
  mode: GameMode;
  seed: number;
  /** Slot numbers taking part, in ascending order. Slot === player id. */
  slots: number[];
  revengeDucks: boolean;
  kickEnabled?: boolean;
}

export function createPlayer(id: number, x: number, y: number): PlayerState {
  return {
    id,
    x: x + 0.5,
    y: y + 0.5,
    facing: Dir.DOWN,
    alive: true,
    soakedAtTick: -1,
    speed: CONFIG.SPEED_BASE,
    balloonCount: CONFIG.BALLOONS_BASE,
    splashRange: CONFIG.RANGE_BASE,
    hasKick: false,
    activeBalloons: 0,
    moving: false,
    emoteId: -1,
    emoteTicks: 0,
    emoteCooldown: 0,
    ghost: false,
    ghostPos: 0,
    ghostCooldown: 0,
    soaks: 0,
    castlesWashed: 0,
    bestChain: 0,
    survivedTicks: 0,
  };
}

export function createRoundState(opts: RoundOptions): GameState {
  const map = generateMap(opts.mode, opts.seed);
  const spawns = spawnPoints(opts.mode);
  const tide = buildTideSchedule(map.width, map.height);

  const players = opts.slots.map((slot) => {
    const spawn = spawns[slot % spawns.length];
    return createPlayer(slot, spawn.x, spawn.y);
  });

  return {
    tick: 0,
    width: map.width,
    height: map.height,
    cells: map.cells,
    castleContents: map.castleContents,
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    lobs: [],
    tideCursor: 0,
    tideOrder: tide.order,
    tideTicks: tide.ticks,
    phase: 'countdown',
    phaseEndTick: CONFIG.COUNTDOWN_TICKS,
    winners: [],
    revengeDucks: opts.revengeDucks,
    kickEnabled: opts.kickEnabled ?? CONFIG.ENABLE_KICK,
    nextEntityId: 1,
    events: [],
  };
}

/** Deep copy of everything mutable. The tide schedule is immutable and shared. */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    cells: state.cells.slice(),
    castleContents: state.castleContents.slice(),
    players: state.players.map((p) => ({ ...p })),
    balloons: state.balloons.map((b) => ({ ...b, passThrough: [...b.passThrough] })),
    splashes: state.splashes.map((s) => ({ ...s, arms: [...s.arms], capped: [...s.capped] })),
    powerups: state.powerups.map((p) => ({ ...p })),
    lobs: state.lobs.map((l) => ({ ...l })),
    winners: [...state.winners],
    events: [],
  };
}

export function inBounds(state: GameState, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < state.width && ty < state.height;
}

export function tileAt(state: GameState, tx: number, ty: number): TileValue {
  if (!inBounds(state, tx, ty)) return Tile.BOULDER;
  return state.cells[idx(state.width, tx, ty)] as TileValue;
}

export function setTile(state: GameState, tx: number, ty: number, value: TileValue): void {
  if (!inBounds(state, tx, ty)) return;
  state.cells[idx(state.width, tx, ty)] = value;
}

export function balloonAtTile(state: GameState, tx: number, ty: number): Balloon | undefined {
  for (const balloon of state.balloons) {
    if (Math.floor(balloon.x) === tx && Math.floor(balloon.y) === ty) return balloon;
  }
  return undefined;
}

/** Tile containing the player's centre - the canonical "where you are". */
export function playerTile(player: PlayerState): { tx: number; ty: number } {
  return { tx: Math.floor(player.x), ty: Math.floor(player.y) };
}

/** Does the player's collision box overlap tile (tx, ty)? */
export function overlapsTile(player: PlayerState, tx: number, ty: number): boolean {
  const r = CONFIG.PLAYER_RADIUS;
  return (
    player.x + r > tx && player.x - r < tx + 1 && player.y + r > ty && player.y - r < ty + 1
  );
}

export type SolidFn = (tx: number, ty: number) => boolean;

/**
 * Collision test from the point of view of one player: terrain is always solid,
 * balloons are solid unless this player is still standing on one they just
 * dropped (or was overlapping when it appeared).
 */
export function makeSolidFn(state: GameState, playerId: number): SolidFn {
  return (tx, ty) => {
    if (!inBounds(state, tx, ty)) return true;
    const tile = state.cells[idx(state.width, tx, ty)];
    if (tile !== Tile.EMPTY) return true;
    const balloon = balloonAtTile(state, tx, ty);
    if (balloon && !balloon.passThrough.includes(playerId)) return true;
    return false;
  };
}

/** Terrain-and-balloon collision with no pass-through exemptions. */
export function makeStrictSolidFn(state: GameState): SolidFn {
  return (tx, ty) => {
    if (!inBounds(state, tx, ty)) return true;
    if (state.cells[idx(state.width, tx, ty)] !== Tile.EMPTY) return true;
    return balloonAtTile(state, tx, ty) !== undefined;
  };
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

export function nextId(state: GameState): number {
  return state.nextEntityId++;
}
