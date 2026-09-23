// Remote-entity interpolation: a short buffer of snapshots stamped with server time, sampled
// INTERP_DELAY_MS behind the newest server time the client has observed. Positions are
// blended between the two bracketing snapshots; when the buffer runs dry the newest snapshot
// is held (never extrapolated), and a jump longer than a tile (respawn, new round) snaps.
import { CONFIG, borderLoopLength, duckXY, type DirCode, type PlayerSnap } from '@splash/shared';

export interface TimedSnapshot {
  serverTime: number;
  tick: number;
  players: readonly PlayerSnap[];
}

export interface Bracket {
  from: TimedSnapshot;
  to: TimedSnapshot;
  /** Blend factor in [0, 1] from `from` to `to`. */
  alpha: number;
}

/** A remote player's render state (sub-unit positions). */
export interface InterpolatedPlayer {
  slot: number;
  x: number;
  y: number;
  facing: DirCode;
  moving: boolean;
  alive: boolean;
  /** Sub-unit position of the revenge duck, or null when not riding one. */
  duck: { x: number; y: number } | null;
}

/** How much history the buffer keeps (at least two snapshots are always kept). */
const KEEP_MS = 1000;
/** Blending across a jump longer than this would draw a critter sliding through walls. */
const TELEPORT_UNITS = CONFIG.SUB * 1.5;

export class SnapshotBuffer {
  private items: TimedSnapshot[] = [];

  get size(): number {
    return this.items.length;
  }

  /** Insert in server-time order (late or duplicate snapshots are tolerated) and trim history. */
  push(snap: TimedSnapshot): void {
    const items = this.items;
    let i = items.length;
    while (i > 0 && items[i - 1].serverTime > snap.serverTime) i--;
    if (i > 0 && items[i - 1].tick === snap.tick) items[i - 1] = snap;
    else items.splice(i, 0, snap);
    const newest = items[items.length - 1].serverTime;
    while (items.length > 2 && items[1].serverTime <= newest - KEEP_MS) items.shift();
  }

  clear(): void {
    this.items = [];
  }

  /** How far the buffer reaches past `time`: snapshots newer than it and the newest one's lead (ms). */
  lead(time: number): { depth: number; leadMs: number } {
    const items = this.items;
    if (items.length === 0) return { depth: 0, leadMs: 0 };
    let depth = 0;
    for (let i = items.length - 1; i >= 0 && items[i].serverTime > time; i--) depth++;
    return { depth, leadMs: items[items.length - 1].serverTime - time };
  }

  /** Snapshots around `time`: clamped to the oldest/newest when `time` is outside the buffer. */
  bracket(time: number): Bracket | null {
    const items = this.items;
    if (items.length === 0) return null;
    const first = items[0];
    const last = items[items.length - 1];
    if (time <= first.serverTime) return { from: first, to: first, alpha: 0 };
    if (time >= last.serverTime) return { from: last, to: last, alpha: 0 };
    let i = items.length - 2;
    while (i > 0 && items[i].serverTime > time) i--;
    const from = items[i];
    const to = items[i + 1];
    const span = to.serverTime - from.serverTime;
    const alpha = span > 0 ? (time - from.serverTime) / span : 1;
    return { from, to, alpha: Math.min(1, Math.max(0, alpha)) };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Blend two loop positions the short way around the border loop. */
function lerpLoop(a: number, b: number, t: number, length: number): number {
  let d = b - a;
  if (d > length / 2) d -= length;
  else if (d < -length / 2) d += length;
  return (((a + d * t) % length) + length) % length;
}

function duckOf(p: PlayerSnap, w: number, h: number): { x: number; y: number } | null {
  return !p.alive && p.duckPos >= 0 ? duckXY(w, h, p.duckPos) : null;
}

function blendDuck(a: PlayerSnap, b: PlayerSnap, t: number, w: number, h: number): { x: number; y: number } | null {
  const nearest = t < 0.5 ? a : b;
  if (a.alive || b.alive || a.duckPos < 0 || b.duckPos < 0) return duckOf(nearest, w, h);
  return duckXY(w, h, lerpLoop(a.duckPos, b.duckPos, t, borderLoopLength(w, h)));
}

/** Blend one player between two snapshots (`b` missing = hold `a`). */
export function blendPlayer(a: PlayerSnap, b: PlayerSnap | undefined, t: number, w: number, h: number): InterpolatedPlayer {
  const to = b ?? a;
  const nearest = t < 0.5 ? a : to;
  const teleport = Math.abs(to.x - a.x) > TELEPORT_UNITS || Math.abs(to.y - a.y) > TELEPORT_UNITS;
  const k = teleport ? (t < 0.5 ? 0 : 1) : t;
  return {
    slot: a.slot,
    x: lerp(a.x, to.x, k),
    y: lerp(a.y, to.y, k),
    facing: nearest.facing,
    moving: a.moving || to.moving,
    alive: nearest.alive,
    duck: blendDuck(a, to, t, w, h),
  };
}

/** Every player of the bracket's `from` snapshot, blended toward `to`. */
export function interpolatePlayers(bracket: Bracket, w: number, h: number): Map<number, InterpolatedPlayer> {
  const out = new Map<number, InterpolatedPlayer>();
  const next = new Map(bracket.to.players.map((p) => [p.slot, p]));
  for (const a of bracket.from.players) out.set(a.slot, blendPlayer(a, next.get(a.slot), bracket.alpha, w, h));
  for (const b of bracket.to.players) if (!out.has(b.slot)) out.set(b.slot, blendPlayer(b, undefined, 0, w, h));
  return out;
}

/** Lateness samples rise quickly (a delayed burst must not starve the buffer) and fall slowly. */
const LATENESS_RISE = 0.5;
const LATENESS_FALL = 0.05;

/**
 * Render clock for remote entities. `serverNow()` estimates the server's current time, but a
 * snapshot only arrives one network trip after it was stamped, so sampling at
 * serverNow - INTERP_DELAY_MS would starve the buffer whenever the one-way latency exceeds the
 * delay. The clock therefore measures how late snapshots arrive (serverNow - serverTime at
 * arrival) and renders INTERP_DELAY_MS behind the newest server time actually observed.
 */
export class InterpClock {
  private lateness = -1;

  /** Record a snapshot stamped `serverTime` arriving at client-estimated server time `serverNow`. */
  observe(serverTime: number, serverNow: number): void {
    const sample = Math.max(0, serverNow - serverTime);
    if (this.lateness < 0) this.lateness = sample;
    else this.lateness += (sample - this.lateness) * (sample > this.lateness ? LATENESS_RISE : LATENESS_FALL);
  }

  /** Server time to sample remote entities at. */
  renderTime(serverNow: number): number {
    return serverNow - Math.max(0, this.lateness) - CONFIG.INTERP_DELAY_MS;
  }

  reset(): void {
    this.lateness = -1;
  }
}
