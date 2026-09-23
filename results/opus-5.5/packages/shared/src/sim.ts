// The authoritative tick. simulateTick mutates the round state and returns the events of that
// tick; the same code runs headless in tests, the soak script and bots' lookahead.
import { resolveBursts } from './burst';
import { CONFIG, speedTilesPerSec } from './config';
import { nearestDuckPos, stepDuck } from './ducks';
import { idx } from './grid';
import { movePlayer, playerTile, slideBalloons, updatePassMasks } from './movement';
import { activeBalloonCount, balloonAt, spawnBalloon } from './state';
import { advanceTide, fizzleFloodedBalloons, isFlooded } from './tide';
import {
  PowerUp,
  Tile,
  type GameEvent,
  type PlayerInput,
  type PlayerState,
  type PowerUpKind,
  type RoundState,
} from './types';

type SoakCause = 'splash' | 'tide' | 'revenge';

/**
 * Advances the round by one tick (see ARCHITECTURE.md section 3 for the order). `inputs` is
 * indexed by slot; null = no movement and no press. Once the round is over only the tick moves.
 */
export function simulateTick(s: RoundState, inputs: (PlayerInput | null)[]): GameEvent[] {
  const events: GameEvent[] = [];
  s.tick++;
  if (s.over) return events;
  applyPlayerInputs(s, inputs, events);
  slideBalloons(s, events);
  collectPowerUps(s, events);
  resolveBursts(s, events);
  runTide(s, events);
  soakPlayers(s, events);
  if (!s.rules.sandbox) checkRoundOver(s, events);
  updatePassMasks(s);
  return events;
}

/**
 * Ticks a player stayed dry this round: until soaked, else the whole round so far. A finished
 * round stops counting at its last tick (the server keeps stepping it while the result settles).
 */
export function survivedTicks(s: RoundState, p: PlayerState): number {
  if (!p.present) return 0;
  if (!p.alive) return Math.max(0, p.soakedTick);
  return s.over ? s.overTick : s.tick;
}

function applyPlayerInputs(s: RoundState, inputs: (PlayerInput | null)[], events: GameEvent[]): void {
  for (const p of s.players) {
    if (!p.present) continue;
    const input = inputs[p.slot] ?? null;
    if (p.alive) actAlive(s, p, input, events);
    else if (p.duckPos >= 0) stepDuck(s, p, input, events);
  }
}

function actAlive(s: RoundState, p: PlayerState, input: PlayerInput | null, events: GameEvent[]): void {
  if (!input) {
    p.moving = false;
    return;
  }
  const { kickedId } = movePlayer(s, p, input.dir, s.rules.kick && p.canKick);
  if (kickedId >= 0) events.push({ type: 'balloon_kicked', id: kickedId, slot: p.slot, dir: input.dir });
  if (input.balloon) tryPlaceBalloon(s, p, events);
}

/** Drop on the player's center tile: under the balloon cap, one per tile, never on flood water. */
function tryPlaceBalloon(s: RoundState, p: PlayerState, events: GameEvent[]): void {
  if (activeBalloonCount(s, p.slot) >= p.maxBalloons) return;
  const { tx, ty } = playerTile(p);
  if (s.tiles[idx(s.w, tx, ty)] !== Tile.Floor) return;
  if (balloonAt(s, tx, ty) !== undefined || isFlooded(s, tx, ty)) return;
  const b = spawnBalloon(s, {
    owner: p.slot,
    tx,
    ty,
    burstTick: s.tick + CONFIG.FUSE_TICKS,
    range: p.range,
    fromDuck: false,
  });
  events.push({ type: 'balloon_placed', id: b.id, x: tx, y: ty, owner: p.slot });
}

function collectPowerUps(s: RoundState, events: GameEvent[]): void {
  for (const p of s.players) {
    if (!p.present || !p.alive) continue;
    const { tx, ty } = playerTile(p);
    const i = idx(s.w, tx, ty);
    const kind = s.items[i] as PowerUpKind;
    if (kind === PowerUp.None) continue;
    s.items[i] = PowerUp.None;
    applyPowerUp(p, kind);
    p.stats.powerups++;
    events.push({ type: 'powerup_collected', x: tx, y: ty, kind, slot: p.slot });
  }
}

/** Power-ups are always consumed; stats stop at their caps and Boots only matter once. */
function applyPowerUp(p: PlayerState, kind: PowerUpKind): void {
  switch (kind) {
    case PowerUp.Balloon:
      p.maxBalloons = Math.min(CONFIG.BALLOONS_CAP, p.maxBalloons + 1);
      break;
    case PowerUp.Range:
      p.range = Math.min(CONFIG.RANGE_CAP, p.range + 1);
      break;
    case PowerUp.Speed:
      if (speedTilesPerSec(p.speedUps) < CONFIG.SPEED_CAP) p.speedUps++;
      break;
    case PowerUp.Boots:
      p.canKick = true;
      break;
  }
}

function runTide(s: RoundState, events: GameEvent[]): void {
  if (s.rules.tide && s.tick >= s.nextTideTick) advanceTide(s, events);
  fizzleFloodedBalloons(s, events);
}

/** Alive players standing in splash water (or flood water) are soaked, splash credit first. */
function soakPlayers(s: RoundState, events: GameEvent[]): void {
  for (const p of s.players) {
    if (!p.present || !p.alive) continue;
    const { tx, ty } = playerTile(p);
    const i = idx(s.w, tx, ty);
    if (s.splashUntil[i] > s.tick) soak(s, p, s.splashOwner[i], s.splashDuck[i] === 1 ? 'revenge' : 'splash', events);
    else if (isFlooded(s, tx, ty)) soak(s, p, -1, 'tide', events);
  }
}

function soak(s: RoundState, p: PlayerState, by: number, cause: SoakCause, events: GameEvent[]): void {
  const { tx, ty } = playerTile(p);
  p.alive = false;
  p.moving = false;
  p.soakedTick = s.tick;
  p.soakedBy = by;
  const soaker = by >= 0 ? s.players[by] : undefined;
  if (by === p.slot) p.stats.selfSoaked = true;
  else if (soaker && cause === 'revenge') soaker.stats.revengeSoaks++;
  else if (soaker) soaker.stats.soaks++;
  if (s.rules.revengeDucks) {
    p.duckPos = nearestDuckPos(s.w, s.h, p.x, p.y);
    p.duckCooldownUntil = s.tick + CONFIG.DUCK_LOB_COOLDOWN_TICKS;
  }
  events.push({ type: 'player_soaked', slot: p.slot, by, cause, x: tx, y: ty });
}

/** One (or zero) present players left dry ends the round; zero means a same-tick draw. */
function checkRoundOver(s: RoundState, events: GameEvent[]): void {
  let alive = 0;
  let survivor = -1;
  for (const p of s.players) {
    if (!p.present || !p.alive) continue;
    alive++;
    survivor = p.slot;
  }
  if (alive > 1) return;
  s.over = true;
  s.overTick = s.tick;
  s.winner = alive === 1 ? survivor : -1;
  events.push(roundOverEvent(s));
}

/**
 * The round_over event of a finished round (it happened on `s.overTick`). Clients learn the
 * outcome only from this event, so the server repeats it to a player re-attaching before
 * round_end.
 */
export function roundOverEvent(s: RoundState): Extract<GameEvent, { type: 'round_over' }> {
  return { type: 'round_over', winner: s.winner, draw: s.winner === -1 };
}

// ---------------------------------------------------------------------------
// State hash (FNV-1a over every state field) for desync / determinism checks
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Streaming FNV-1a over 32-bit integers (little-endian bytes). */
class Fnv1a {
  private h = FNV_OFFSET;

  int(v: number): this {
    const x = v | 0;
    let h = this.h;
    h = Math.imul(h ^ (x & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 8) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 16) & 0xff), FNV_PRIME);
    this.h = Math.imul(h ^ (x >>> 24), FNV_PRIME);
    return this;
  }

  bool(v: boolean): this {
    return this.int(v ? 1 : 0);
  }

  ints(values: ArrayLike<number>): this {
    this.int(values.length);
    for (let i = 0; i < values.length; i++) this.int(values[i]);
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }
}

export function stateHash(s: RoundState): number {
  const f = new Fnv1a();
  f.int(s.w).int(s.h).int(s.tick).int(s.tideLevel).int(s.nextTideTick).int(s.nextId);
  f.bool(s.over).int(s.overTick).int(s.winner);
  f.bool(s.rules.kick).bool(s.rules.revengeDucks).bool(s.rules.tide).int(s.rules.tideStartTick).bool(s.rules.sandbox);
  f.ints(s.tiles).ints(s.hidden).ints(s.items).ints(s.splashUntil).ints(s.splashOwner).ints(s.splashDuck);
  f.int(s.players.length);
  for (const p of s.players) {
    f.int(p.slot).bool(p.present).int(p.x).int(p.y).int(p.facing).bool(p.moving).bool(p.alive);
    f.int(p.speedUps).int(p.maxBalloons).int(p.range).bool(p.canKick);
    f.int(p.soakedTick).int(p.soakedBy).int(p.duckPos).int(p.duckCooldownUntil);
    const st = p.stats;
    f.int(st.soaks).int(st.revengeSoaks).int(st.castles).int(st.biggestChain).int(st.powerups).bool(st.selfSoaked);
  }
  f.int(s.balloons.length);
  for (const b of s.balloons) {
    f.int(b.id).int(b.owner).int(b.tx).int(b.ty).int(b.x).int(b.y).int(b.placedTick).int(b.burstTick);
    f.int(b.range).int(b.slideDir).int(b.passMask).bool(b.fromDuck);
  }
  f.int(s.splashes.length);
  for (const sp of s.splashes) {
    f.int(sp.id).int(sp.owner).int(sp.cx).int(sp.cy).ints(sp.arms);
    f.int(sp.startTick).int(sp.endTick).int(sp.chainId).bool(sp.fromDuck);
  }
  return f.digest();
}
