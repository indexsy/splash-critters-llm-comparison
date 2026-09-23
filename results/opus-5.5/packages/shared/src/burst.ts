// Balloon bursts: cross-shaped splashes, chain cascades resolved in one tick (BFS), castle
// washing with power-up reveals, and exposed power-up destruction.
import { CONFIG } from './config';
import { ALL_DIRS, DIR_DX, DIR_DY, idx, inBounds } from './grid';
import { balloonAt } from './state';
import { PowerUp, Tile, type Balloon, type GameEvent, type RoundState, type PowerUpKind } from './types';

/** Splash reach per direction: [up, down, left, right]. */
type Arms = [number, number, number, number];

/** Who a cascade's soaks are credited to (and whether they count as revenge-duck soaks). */
interface Credit {
  owner: number;
  duck: boolean;
}

/** Bookkeeping for one burst phase (one simulateTick). */
interface BurstPhase {
  /** Balloons already burst this phase: splash arms pass through their tiles. */
  burst: Set<number>;
  /** Balloons already assigned to a cascade. */
  queued: Set<number>;
  /** 1 for every tile splashed during this phase. */
  newlySplashed: Uint8Array;
  /** Slot credited for washing each castle (first splash to reach it), -1 = not washed. */
  washedBy: Int8Array;
}

/**
 * Arms a balloon at (tx, ty) with `range` would reach right now: an arm stops before an
 * out-of-bounds tile or boulder and includes (then stops at) the first castle or balloon.
 * Pure; bots use it for danger maps.
 */
export function computeArms(s: RoundState, tx: number, ty: number, range: number): Arms {
  return walkArms(s, tx, ty, range, (x, y) => balloonAt(s, x, y) !== undefined);
}

function walkArms(
  s: RoundState,
  tx: number,
  ty: number,
  range: number,
  stopsAtBalloon: (x: number, y: number) => boolean,
): Arms {
  const arms: Arms = [0, 0, 0, 0];
  for (let a = 0; a < ALL_DIRS.length; a++) {
    const dir = ALL_DIRS[a];
    for (let k = 1; k <= range; k++) {
      const x = tx + DIR_DX[dir] * k;
      const y = ty + DIR_DY[dir] * k;
      if (!inBounds(s.w, s.h, x, y)) break;
      const tile = s.tiles[idx(s.w, x, y)];
      if (tile === Tile.Boulder) break;
      arms[a] = k;
      if (tile === Tile.Castle || stopsAtBalloon(x, y)) break;
    }
  }
  return arms;
}

/** Center tile followed by the arm tiles (up, down, left, right, nearest first). */
export function splashTiles(cx: number, cy: number, arms: readonly number[]): { x: number; y: number }[] {
  const out = [{ x: cx, y: cy }];
  for (let a = 0; a < ALL_DIRS.length; a++) {
    const dir = ALL_DIRS[a];
    for (let k = 1; k <= arms[a]; k++) out.push({ x: cx + DIR_DX[dir] * k, y: cy + DIR_DY[dir] * k });
  }
  return out;
}

/**
 * Bursts every due balloon (fuse elapsed or sitting in lingering splash) and everything they
 * chain into, all within this tick. Castles are judged as they were at the start of the phase;
 * items are destroyed before washed castles reveal theirs, so fresh reveals survive this tick.
 */
export function resolveBursts(s: RoundState, events: GameEvent[]): void {
  s.splashes = s.splashes.filter((sp) => sp.endTick > s.tick);
  const seeds = s.balloons
    .filter((b) => b.burstTick <= s.tick || s.splashUntil[idx(s.w, b.tx, b.ty)] > s.tick)
    .sort((a, b) => a.id - b.id);
  if (seeds.length === 0) return;
  const phase: BurstPhase = {
    burst: new Set(),
    queued: new Set(),
    newlySplashed: new Uint8Array(s.w * s.h),
    washedBy: new Int8Array(s.w * s.h).fill(-1),
  };
  // Credits are read before any splash of this phase is painted: a seed set off by LINGERING
  // splash is credited to whoever owns that earlier splash.
  const credits = new Map(seeds.map((b) => [b.id, cascadeCredit(s, b)]));
  for (const seed of seeds) {
    if (!phase.queued.has(seed.id)) runCascade(s, seed, credits.get(seed.id)!, phase, events);
  }
  s.balloons = s.balloons.filter((b) => !phase.burst.has(b.id));
  destroySplashedItems(s, phase, events);
  washCastles(s, phase, events);
}

/**
 * Soaks from a cascade are credited to whoever set it off: the seed's owner when its fuse ran
 * out, or the owner of the lingering splash it was sitting in. So an opponent whose balloon
 * chains into yours and soaks you gets the soak, rather than it counting as your self-soak.
 */
function cascadeCredit(s: RoundState, seed: Balloon): Credit {
  const i = idx(s.w, seed.tx, seed.ty);
  const setOffByLingering = seed.burstTick > s.tick && s.splashUntil[i] > s.tick && s.splashOwner[i] >= 0;
  return setOffByLingering ? { owner: s.splashOwner[i], duck: s.splashDuck[i] === 1 } : { owner: seed.owner, duck: seed.fromDuck };
}

/** BFS from one seed: every balloon reached by the cascade bursts with its own range. */
function runCascade(s: RoundState, seed: Balloon, credit: Credit, phase: BurstPhase, events: GameEvent[]): void {
  const chainId = seed.id;
  const queue: Balloon[] = [seed];
  phase.queued.add(seed.id);
  for (let head = 0; head < queue.length; head++) {
    for (const next of burstBalloon(s, queue[head], chainId, credit, phase, events)) {
      if (phase.queued.has(next.id)) continue;
      phase.queued.add(next.id);
      queue.push(next);
    }
  }
  if (queue.length < 2) return;
  events.push({ type: 'chain_burst', count: queue.length, x: seed.tx, y: seed.ty, owner: seed.owner, chainId });
  const owner = s.players[seed.owner];
  if (owner) owner.stats.biggestChain = Math.max(owner.stats.biggestChain, queue.length);
}

/**
 * Bursts one balloon, paints its splash and returns the unburst balloons its arms reached.
 * Soak credit on the painted tiles goes to the cascade's `credit`; castle credit and the visible
 * splash (owner colour) stay with the balloon's own thrower.
 */
function burstBalloon(
  s: RoundState,
  b: Balloon,
  chainId: number,
  credit: Credit,
  phase: BurstPhase,
  events: GameEvent[],
): Balloon[] {
  phase.burst.add(b.id);
  const unburstAt = (x: number, y: number): Balloon | undefined => {
    const other = balloonAt(s, x, y);
    return other !== undefined && !phase.burst.has(other.id) ? other : undefined;
  };
  const arms = walkArms(s, b.tx, b.ty, b.range, (x, y) => unburstAt(x, y) !== undefined);
  const reached: Balloon[] = [];
  const until = s.tick + CONFIG.SPLASH_TICKS;
  for (const t of splashTiles(b.tx, b.ty, arms)) {
    const i = idx(s.w, t.x, t.y);
    s.splashUntil[i] = until;
    s.splashOwner[i] = credit.owner;
    s.splashDuck[i] = credit.duck ? 1 : 0;
    phase.newlySplashed[i] = 1;
    if (s.tiles[i] === Tile.Castle && phase.washedBy[i] < 0) phase.washedBy[i] = b.owner;
    const other = unburstAt(t.x, t.y);
    if (other) reached.push(other);
  }
  s.splashes.push({
    id: s.nextId++,
    owner: b.owner,
    cx: b.tx,
    cy: b.ty,
    arms,
    startTick: s.tick,
    endTick: until,
    chainId,
    fromDuck: b.fromDuck,
  });
  events.push({
    type: 'balloon_burst',
    id: b.id,
    x: b.tx,
    y: b.ty,
    owner: b.owner,
    arms: [arms[0], arms[1], arms[2], arms[3]],
    chainId,
    fromDuck: b.fromDuck,
  });
  return reached;
}

/** Exposed items on tiles splashed this phase are destroyed (row-major order). */
function destroySplashedItems(s: RoundState, phase: BurstPhase, events: GameEvent[]): void {
  for (let i = 0; i < s.items.length; i++) {
    if (phase.newlySplashed[i] === 0 || s.items[i] === PowerUp.None) continue;
    events.push({ type: 'powerup_destroyed', x: i % s.w, y: Math.floor(i / s.w), kind: s.items[i] as PowerUpKind });
    s.items[i] = PowerUp.None;
  }
}

/** Washed castles become floor, credit their washer and reveal their hidden item (row-major). */
function washCastles(s: RoundState, phase: BurstPhase, events: GameEvent[]): void {
  for (let i = 0; i < s.tiles.length; i++) {
    const by = phase.washedBy[i];
    if (by < 0) continue;
    const x = i % s.w;
    const y = Math.floor(i / s.w);
    s.tiles[i] = Tile.Floor;
    const washer = s.players[by];
    if (washer) washer.stats.castles++;
    events.push({ type: 'castle_washed', x, y, by });
    const kind = s.hidden[i] as PowerUpKind;
    if (kind === PowerUp.None) continue;
    s.hidden[i] = PowerUp.None;
    s.items[i] = kind;
    events.push({ type: 'powerup_revealed', x, y, kind });
  }
}
