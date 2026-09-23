// Transient match visuals driven by server events: splash crosses, castle crumbles, revenge-lob
// arcs, water rings, item pops, soak animations, emote bubbles, screen shake, hit-stop and the
// particle pool. Timestamps are performance.now() milliseconds.
import { CONFIG, type EmoteId } from '@splash/shared';
import { Shake } from './camera';
import { Particles } from './particles';
import { CASTLE_CRUMBLE_FRAMES } from './tiles';

export interface SplashFx {
  cx: number;
  cy: number;
  arms: readonly [number, number, number, number];
  owner: number;
  fromDuck: boolean;
  startMs: number;
}

export interface TileFx {
  tx: number;
  ty: number;
  startMs: number;
}

export interface LobFx {
  id: number;
  slot: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
}

export interface RingFx {
  /** Arena pixel center. */
  x: number;
  y: number;
  maxR: number;
  color: string;
  startMs: number;
  durationMs: number;
}

export interface SoakFx {
  /** Sub-unit position the critter was soaked at. */
  x: number;
  y: number;
  startMs: number;
}

export interface EmoteFx {
  id: EmoteId;
  startMs: number;
}

/** Small text rising from a spot in the arena (pickups). Arena pixel coordinates. */
export interface FloaterFx {
  text: string;
  color: string;
  x: number;
  y: number;
  startMs: number;
}

/** Splash water stays on a tile for SPLASH_TICKS (lethal the whole time). */
export const SPLASH_MS = CONFIG.SPLASH_TICKS * CONFIG.TICK_MS;
export const CRUMBLE_FRAME_MS = 70;
const CRUMBLE_MS = CASTLE_CRUMBLE_FRAMES * CRUMBLE_FRAME_MS;
/** Flight time of a revenge-duck lob from the border to its landing tile. */
export const LOB_FLIGHT_MS = 420;
export const ITEM_POP_MS = 260;
export const EMOTE_MS = 1600;
export const FLOATER_MS = 900;
/** A newly flooded ring fills in over this long. */
export const FLOOD_FILL_MS = 450;
/** Soak puddles fade out this long after the animation ends. */
export const SOAK_LINGER_MS = 2600;

/**
 * Effects are pruned once per rendered frame; while a tab is hidden no frames run but events
 * still arrive, so every effect list is capped (oldest dropped) to keep memory flat.
 */
const MAX_EFFECTS = 96;

export function pushCapped<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > MAX_EFFECTS) list.splice(0, list.length - MAX_EFFECTS);
}

export class Fx {
  readonly particles = new Particles();
  readonly shake = new Shake();
  splashes: SplashFx[] = [];
  crumbles: TileFx[] = [];
  pops: TileFx[] = [];
  lobs: LobFx[] = [];
  rings: RingFx[] = [];
  floaters: FloaterFx[] = [];
  readonly soaks = new Map<number, SoakFx>();
  readonly emotes = new Map<number, EmoteFx>();
  /** Tide level whose ring is currently filling, and when it started. */
  flood = { level: 0, startMs: 0 };
  private holdUntil = 0;
  private holdPendingMs = 0;

  /** Freeze the arena for `ms` starting after the next rendered frame (hit-stop on soaks). */
  hitStop(ms: number): void {
    this.holdPendingMs = Math.max(this.holdPendingMs, ms);
  }

  /** True while the last frame should stay on screen. */
  holding(nowMs: number): boolean {
    return nowMs < this.holdUntil;
  }

  /** Call after every rendered frame: arms a pending hit-stop so the impact frame is the one held. */
  afterFrame(nowMs: number): void {
    if (this.holdPendingMs > 0) {
      this.holdUntil = nowMs + this.holdPendingMs;
      this.holdPendingMs = 0;
    }
  }

  /** Is a lob still flying toward the balloon with this id (hide the landed balloon until then)? */
  lobInFlight(id: number, nowMs: number): boolean {
    return this.lobs.some((l) => l.id === id && nowMs - l.startMs < LOB_FLIGHT_MS);
  }

  /** Drop finished effects and advance particles. */
  update(nowMs: number, dtMs: number): void {
    this.splashes = this.splashes.filter((s) => nowMs - s.startMs < SPLASH_MS);
    this.crumbles = this.crumbles.filter((c) => nowMs - c.startMs < CRUMBLE_MS);
    this.pops = this.pops.filter((p) => nowMs - p.startMs < ITEM_POP_MS);
    this.lobs = this.lobs.filter((l) => nowMs - l.startMs < LOB_FLIGHT_MS);
    this.rings = this.rings.filter((r) => nowMs - r.startMs < r.durationMs);
    this.floaters = this.floaters.filter((f) => nowMs - f.startMs < FLOATER_MS);
    for (const [slot, e] of this.emotes) if (nowMs - e.startMs >= EMOTE_MS) this.emotes.delete(slot);
    this.particles.update(dtMs / 1000);
  }

  /** New round: nothing from the previous arena carries over. */
  reset(): void {
    this.particles.clear();
    this.splashes = [];
    this.crumbles = [];
    this.pops = [];
    this.lobs = [];
    this.rings = [];
    this.floaters = [];
    this.soaks.clear();
    this.emotes.clear();
    this.flood = { level: 0, startMs: 0 };
    this.holdUntil = 0;
    this.holdPendingMs = 0;
  }
}
