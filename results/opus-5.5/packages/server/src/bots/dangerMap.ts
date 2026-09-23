// DangerMap: for every tile, the tick windows during which it will be wet (pending bursts with
// chains, kicked balloons, lingering splashes, the rising tide). Recomputed every tick from public
// state only; all bots of a room share the same map for a given tick (cached per state object).
import { CONFIG, idx, type RoundState } from '@splash/shared';
import { WetKind, prepareDangerInput, simulateDanger, type DangerInput, type DangerResult, type PendingBalloon } from './dangerSim';

const EMPTY: readonly number[] = [];

/** What a path search needs from a danger picture: every tile's wet windows. */
export interface WetWindows {
  readonly w: number;
  readonly h: number;
  /** Merged, sorted wet windows of a tile as [from, until, from, until, ...]. */
  intervals(tile: number): readonly number[];
  /** Is the tile dry from `from` (inclusive) to `until` (exclusive)? */
  isDryBetween(tile: number, from: number, until: number): boolean;
}

/** Is `[from, until)` clear of every window in `iv` ([from, until, ...])? */
function dryBetween(iv: readonly number[], from: number, until: number): boolean {
  for (let k = 0; k < iv.length; k += 2) {
    if (iv[k] < until && iv[k + 1] > from) return false;
  }
  return true;
}
const NONE_OCCUPIED: readonly Occupied[] = [];

/** A tile nobody may stand on during [from, until): a balloon seen by the players it blocks. */
interface Occupied {
  tile: number;
  from: number;
  until: number;
}

export class DangerMap {
  readonly tick: number;
  readonly w: number;
  readonly h: number;
  private readonly merged: (readonly number[] | undefined)[];

  private constructor(
    private readonly input: DangerInput,
    private readonly result: DangerResult,
    /** Slot whose own cascades are judged exactly while everyone else's are shifted by `delay`. */
    private readonly viewer: number,
    private readonly delay: number,
    /** Hypothetical balloons added on top of the real ones (see withBalloon). */
    private readonly extras: readonly PendingBalloon[] = [],
    /** Hypothetical time-limited obstacles, treated as wet (see withOccupied). */
    private readonly occupied: readonly Occupied[] = [],
    /**
     * The map this one was derived from by adding a balloon or an obstacle: on every tile the
     * addition leaves untouched the windows are the same, and its cache is reused.
     */
    private readonly base: DangerMap | null = null,
  ) {
    this.tick = input.tick;
    this.w = input.w;
    this.h = input.h;
    this.merged = new Array(input.w * input.h);
  }

  static fromState(s: RoundState): DangerMap {
    const input = prepareDangerInput(s);
    return new DangerMap(input, simulateDanger(input), -1, 0);
  }

  /**
   * Hypothetical: the same world (hypothetical balloons included) plus one more balloon at
   * (tx, ty), including every chain it would trigger or join. `burstTick` defaults to a balloon
   * dropped on the next tick. The new balloon's id is the result's nextBalloonId.
   */
  withBalloon(tx: number, ty: number, range: number, owner: number, burstTick = this.tick + 1 + CONFIG.FUSE_TICKS): DangerMap {
    const id = this.input.nextId + this.extras.length;
    const extras = [...this.extras, { id, owner, range, burstTick, path: [idx(this.w, tx, ty)], enter: [this.tick] }];
    return new DangerMap(this.input, simulateDanger(this.input, extras), this.viewer, this.delay, extras, this.occupied, this);
  }

  /** The same world without the latest hypothetical balloon (the map withBalloon was called on). */
  withoutLatest(): DangerMap {
    const last = this.extras.length - 1;
    if (last < 0) throw new Error('withoutLatest: no hypothetical balloon to take away');
    const base = this.base;
    if (base !== null && base.extras.length === last && base.occupied === this.occupied) return base;
    const extras = this.extras.slice(0, last);
    return new DangerMap(this.input, simulateDanger(this.input, extras), this.viewer, this.delay, extras, this.occupied);
  }

  /**
   * The map as a careless player sees it: cascades that contain none of `slot`'s balloons, and the
   * tide's coming floods, look `delay` ticks later than they really are. Visible water (lingering
   * splashes, flooded rings) stays exact.
   */
  perceivedBy(slot: number, delay: number): DangerMap {
    if (delay === 0 && this.delay === 0) return this;
    return new DangerMap(this.input, this.result, slot, delay, this.extras, this.occupied);
  }

  /** Hypothetical: balloon `id` kicked along `path` (entering path[k] on tick enter[k]), bursting at `burstTick` at the latest. */
  withKick(id: number, path: number[], enter: number[], burstTick: number): DangerMap {
    const balloons = this.input.balloons.map((b) => (b.id === id ? { ...b, path, enter, burstTick } : b));
    const input = { ...this.input, balloons };
    return new DangerMap(input, simulateDanger(input, this.extras), this.viewer, this.delay, this.extras, this.occupied);
  }

  /**
   * Hypothetical, for judging other players: nobody may stand on `tile` from tick `from` until
   * `until` (exclusive). A balloon still to be dropped there becomes an obstacle only once it is
   * placed; modelled as water, a mover can cross the tile before then but not be on it after.
   */
  withOccupied(tile: number, from: number, until: number): DangerMap {
    const occupied = [...this.occupied, { tile, from, until }];
    return new DangerMap(this.input, this.result, this.viewer, this.delay, this.extras, occupied, this);
  }

  /** Tiles a pending cascade containing one of `slot`'s balloons will splash. */
  tilesWetBy(slot: number): number[] {
    const out: number[] = [];
    const bit = 1 << slot;
    this.result.wet.forEach((raw, tile) => {
      if (!raw) return;
      for (let k = 2; k < raw.length; k += 3) {
        if (raw[k] >> 8 === WetKind.Cascade && (raw[k] & bit) !== 0) {
          out.push(tile);
          return;
        }
      }
    });
    return out;
  }

  /** Hypothetical: the given balloons (id -> tick) burst earlier than their fuses say. */
  withEarlierBursts(earlier: ReadonlyMap<number, number>): DangerMap {
    const balloons = this.input.balloons.map((b) => {
      const at = earlier.get(b.id);
      return at !== undefined && at < b.burstTick ? { ...b, burstTick: at } : b;
    });
    const input = { ...this.input, balloons };
    return new DangerMap(input, simulateDanger(input, this.extras), this.viewer, this.delay, this.extras, this.occupied);
  }

  /** Tiles balloons (hypothetical ones included) occupy now or will slide through and rest on (obstacles for path search). */
  balloonTiles(): readonly number[] {
    const out: number[] = [];
    for (const b of this.input.balloons) out.push(...b.path);
    for (const b of this.extras) out.push(...b.path);
    return out;
  }

  /** Tick the whole arena is flooded by the rising tide (Infinity without tide). */
  get lastFloodTick(): number {
    return this.input.lastFlood;
  }

  /**
   * Id of the latest hypothetical balloon (query its burst with burstTickOf); on a map without
   * one, the id withBalloon will give the first.
   */
  get nextBalloonId(): number {
    return this.extras.length > 0 ? this.extras[this.extras.length - 1].id : this.input.nextId;
  }

  /** Chain-aware tick at which a balloon will burst (Infinity if it fizzles or is unknown). */
  burstTickOf(balloonId: number): number {
    return this.result.burstTicks.get(balloonId) ?? Infinity;
  }

  /** Earliest tick (> now) at which the tile is wet; Infinity if it never is. */
  dangerAt(tx: number, ty: number): number {
    return this.firstWetFrom(idx(this.w, tx, ty), this.tick + 1);
  }

  /** Exclusive tick after which the tile stays dry for good (0 = never wet, Infinity = flooding). */
  wetUntil(tx: number, ty: number): number {
    const iv = this.intervals(idx(this.w, tx, ty));
    return iv.length === 0 ? 0 : iv[iv.length - 1];
  }

  /** No splash, lingering water or tide will ever touch the tile. */
  isSafeForever(tx: number, ty: number): boolean {
    return this.intervals(idx(this.w, tx, ty)).length === 0;
  }

  /** Is the tile safe to stand on from tick `from` (inclusive) to `until` (exclusive)? */
  isDryBetween(tile: number, from: number, until: number): boolean {
    return dryBetween(this.intervals(tile), from, until);
  }

  isWetAt(tile: number, t: number): boolean {
    return !this.isDryBetween(tile, t, t + 1);
  }

  /** Earliest wet tick >= t on a tile index (Infinity if none). */
  firstWetFrom(tile: number, t: number): number {
    const iv = this.intervals(tile);
    for (let k = 0; k < iv.length; k += 2) {
      if (iv[k + 1] > t) return Math.max(iv[k], t);
    }
    return Infinity;
  }

  /** Merged, sorted wet windows of a tile as [from, until, from, until, ...] (tide last, until = Infinity). */
  intervals(tile: number): readonly number[] {
    const cached = this.merged[tile];
    if (cached) return cached;
    const base = this.base;
    const built = base !== null && this.sameAs(base, tile) ? base.intervals(tile) : this.buildIntervals(tile);
    this.merged[tile] = built;
    return built;
  }

  /** Does `tile` have the same windows here as on `base` (a map this one was derived from)? */
  private sameAs(base: DangerMap, tile: number): boolean {
    if (this.occupied !== base.occupied && this.occupied.some((o) => o.tile === tile)) return false;
    if (this.result === base.result) return true;
    const a = this.result.wet[tile];
    const b = base.result.wet[tile];
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
    return true;
  }

  private buildIntervals(tile: number): readonly number[] {
    const raw = this.result.wet[tile];
    const flood = this.input.floodTick[tile];
    const blocks = this.occupied.length === 0 ? NONE_OCCUPIED : this.occupied.filter((o) => o.tile === tile && o.until > this.tick + 1);
    if (!raw && flood === Infinity && blocks.length === 0) return EMPTY;
    if (!raw && this.delay === 0 && blocks.length === 0) {
      const shared = this.input.tideOnly;
      return (shared[tile] ??= [Math.max(flood, this.tick + 1), Infinity]);
    }
    const spans: [number, number][] = blocks.map((o) => [Math.max(o.from, this.tick + 1), o.until]);
    if (raw) for (let k = 0; k < raw.length; k += 3) spans.push(this.perceive(raw[k], raw[k + 1], raw[k + 2]));
    if (flood !== Infinity) spans.push([Math.max(flood > this.tick ? flood + this.delay : flood, this.tick + 1), Infinity]);
    spans.sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    for (const [from, until] of spans) {
      const last = out.length - 1;
      if (last > 0 && from <= out[last]) out[last] = Math.max(out[last], until);
      else out.push(from, until);
    }
    return out;
  }

  private perceive(from: number, until: number, meta: number): [number, number] {
    const kind = meta >> 8;
    const owners = meta & 0xff;
    const misjudged = this.delay > 0 && kind !== WetKind.Lingering && (owners & (1 << this.viewer)) === 0;
    return misjudged ? [from + this.delay, until + this.delay] : [from, until];
  }
}

// ---------------------------------------------------------------------------
// Per-tick shared cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  map: DangerMap;
}

const cache = new WeakMap<RoundState, CacheEntry>();

/** Everything that can change the danger picture between two calls with the same state object. */
function fingerprint(s: RoundState): string {
  let key = `${s.tick}|${s.nextId}|${s.tideLevel}|${s.nextTideTick}|${s.balloons.length}`;
  for (const b of s.balloons) key += `|${b.id}:${b.x}:${b.y}:${b.slideDir}`;
  return key;
}

/** The (shared) danger map for this tick. Bots of the same room reuse one computation per tick. */
export function getDangerMap(s: RoundState): DangerMap {
  const key = fingerprint(s);
  const hit = cache.get(s);
  if (hit && hit.key === key) return hit.map;
  const map = DangerMap.fromState(s);
  cache.set(s, { key, map });
  return map;
}

/** Sorted, merged windows ([from, until, ...]) covering every [from, until] span given. */
function mergeSpans(spans: number[][]): number[] {
  spans.sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (const [from, until] of spans) {
    const last = out.length - 1;
    if (last > 0 && from <= out[last]) out[last] = Math.max(out[last], until);
    else out.push(from, until);
  }
  return out;
}

/** A tile's windows in `iv` ([from, until, ...]) as spans. */
function spansOf(iv: readonly number[], into: number[][]): void {
  for (let k = 0; k < iv.length; k += 2) into.push([iv[k], iv[k + 1]]);
}

/**
 * Two possible futures at once (say, with and without an opponent's answer): a tile is wet
 * whenever it is wet in either, so a route that stays dry here is safe whichever one happens.
 */
export function eitherFuture(a: WetWindows, b: WetWindows): WetWindows {
  const merged: (readonly number[] | undefined)[] = new Array(a.w * a.h);
  const intervals = (tile: number): readonly number[] => {
    const cached = merged[tile];
    if (cached) return cached;
    const spans: number[][] = [];
    spansOf(a.intervals(tile), spans);
    spansOf(b.intervals(tile), spans);
    return (merged[tile] = mergeSpans(spans));
  };
  return { w: a.w, h: a.h, intervals, isDryBetween: (tile, from, until) => dryBetween(intervals(tile), from, until) };
}

/** `base` plus some water that may come: `extra` maps a tile to its extra windows ([from, until, ...]). */
export function withExtraWater(base: WetWindows, extra: ReadonlyMap<number, readonly number[]>): WetWindows {
  if (extra.size === 0) return base;
  const merged = new Map<number, readonly number[]>();
  const intervals = (tile: number): readonly number[] => {
    const more = extra.get(tile);
    if (!more) return base.intervals(tile);
    let out = merged.get(tile);
    if (!out) {
      const spans: number[][] = [];
      spansOf(base.intervals(tile), spans);
      spansOf(more, spans);
      out = mergeSpans(spans);
      merged.set(tile, out);
    }
    return out;
  };
  return { w: base.w, h: base.h, intervals, isDryBetween: (tile, from, until) => dryBetween(intervals(tile), from, until) };
}
