// Round state construction, cloning and small read-only queries shared by every sim module.
import { CONFIG } from './config';
import { tileCenter } from './grid';
import type { GeneratedMap } from './map';
import { Dir, type Balloon, type PlayerState, type RoundState, type SimRules } from './types';

/** Rule set for a round: ranked disables revenge ducks (per CONFIG), the tutorial is a sandbox. */
export function makeRules(opts: { ranked: boolean; tutorial?: boolean }): SimRules {
  const tutorial = opts.tutorial === true;
  const ducksAllowed: boolean = opts.ranked ? CONFIG.REVENGE_DUCKS_IN_RANKED : true;
  return {
    kick: CONFIG.ENABLE_KICK,
    revengeDucks: CONFIG.ENABLE_REVENGE_DUCKS && ducksAllowed && !tutorial,
    tide: !tutorial,
    tideStartTick: CONFIG.TIDE_START_TICKS,
    sandbox: tutorial,
  };
}

/**
 * Fresh round state. `present[slot]` says which slots take part; one PlayerState is created per
 * entry (absent slots stay inert). Map arrays are copied so the map can be reused.
 */
export function createRoundState(map: GeneratedMap, present: boolean[], rules: SimRules): RoundState {
  const n = map.w * map.h;
  return {
    w: map.w,
    h: map.h,
    tick: 0,
    tiles: map.tiles.slice(),
    hidden: map.hidden.slice(),
    items: new Uint8Array(n),
    splashUntil: new Int32Array(n),
    splashOwner: new Int8Array(n).fill(-1),
    splashDuck: new Uint8Array(n),
    tideLevel: 0,
    nextTideTick: rules.tideStartTick,
    players: present.map((isPresent, slot) => createPlayer(map, slot, isPresent)),
    balloons: [],
    splashes: [],
    nextId: 1,
    rules: { ...rules },
    over: false,
    overTick: -1,
    winner: -1,
  };
}

function createPlayer(map: GeneratedMap, slot: number, present: boolean): PlayerState {
  const spawn = map.spawns.find((sp) => sp.slot === slot);
  if (present && !spawn) throw new Error(`createRoundState: no spawn for present slot ${slot}`);
  const at = spawn ?? map.spawns[0] ?? { tx: 0, ty: 0 };
  return {
    slot,
    present,
    x: tileCenter(at.tx),
    y: tileCenter(at.ty),
    facing: Dir.Down,
    moving: false,
    alive: present,
    speedUps: 0,
    maxBalloons: CONFIG.BALLOONS_BASE,
    range: CONFIG.RANGE_BASE,
    canKick: false,
    soakedTick: -1,
    soakedBy: -1,
    duckPos: -1,
    duckCooldownUntil: 0,
    stats: { soaks: 0, revengeSoaks: 0, castles: 0, biggestChain: 0, powerups: 0, selfSoaked: false },
  };
}

/** Deep copy: typed arrays, entity arrays and nested objects are all fresh. */
export function cloneState(s: RoundState): RoundState {
  return {
    ...s,
    tiles: s.tiles.slice(),
    hidden: s.hidden.slice(),
    items: s.items.slice(),
    splashUntil: s.splashUntil.slice(),
    splashOwner: s.splashOwner.slice(),
    splashDuck: s.splashDuck.slice(),
    players: s.players.map((p) => ({ ...p, stats: { ...p.stats } })),
    balloons: s.balloons.map((b) => ({ ...b })),
    splashes: s.splashes.map((sp) => ({ ...sp, arms: [sp.arms[0], sp.arms[1], sp.arms[2], sp.arms[3]] })),
    rules: { ...s.rules },
  };
}

/** Thrown balloons a player currently has on the field (revenge-duck lobs do not count). */
export function activeBalloonCount(s: RoundState, slot: number): number {
  let n = 0;
  for (const b of s.balloons) if (b.owner === slot && !b.fromDuck) n++;
  return n;
}

export function balloonAt(s: RoundState, tx: number, ty: number): Balloon | undefined {
  for (const b of s.balloons) if (b.tx === tx && b.ty === ty) return b;
  return undefined;
}

/** True if the player's collision box (center +/- PLAYER_HALF) overlaps tile (tx, ty). */
export function playerBoxOverlapsTile(p: PlayerState, tx: number, ty: number): boolean {
  const half = CONFIG.PLAYER_HALF;
  const sub = CONFIG.SUB;
  return (
    p.x + half > tx * sub && p.x - half < (tx + 1) * sub && p.y + half > ty * sub && p.y - half < (ty + 1) * sub
  );
}

/** Bitmask of alive players overlapping a tile: they may walk off a balloon placed there. */
export function passMaskForTile(s: RoundState, tx: number, ty: number): number {
  let mask = 0;
  for (const p of s.players) {
    if (p.present && p.alive && playerBoxOverlapsTile(p, tx, ty)) mask |= 1 << p.slot;
  }
  return mask;
}

/** Creates a stationary balloon at a tile center (ids come from s.nextId, so s.balloons stays id-sorted). */
export function spawnBalloon(
  s: RoundState,
  spec: { owner: number; tx: number; ty: number; burstTick: number; range: number; fromDuck: boolean },
): Balloon {
  const balloon: Balloon = {
    id: s.nextId++,
    owner: spec.owner,
    tx: spec.tx,
    ty: spec.ty,
    x: tileCenter(spec.tx),
    y: tileCenter(spec.ty),
    placedTick: s.tick,
    burstTick: spec.burstTick,
    range: spec.range,
    slideDir: Dir.None,
    passMask: passMaskForTile(s, spec.tx, spec.ty),
    fromDuck: spec.fromDuck,
  };
  s.balloons.push(balloon);
  return balloon;
}
