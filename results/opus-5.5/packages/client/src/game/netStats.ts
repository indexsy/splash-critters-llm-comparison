// Opt-in netcode diagnostics: ?netstats=1 (or F3 during a match) shows a small overlay in the
// bottom-right corner with RTT, input->ack delay, pending inputs, reconciliation corrections,
// interpolation buffer depth and snapshot interval jitter; F3 toggles the overlay. Once turned on
// the collector also keeps a short per-frame trace of where every critter was drawn plus the key
// edges, exposed read-only as `window.splashNetStats` so automated feel tests can measure what
// a player sees.
import { CONFIG } from '@splash/shared';
import { net } from '../net';
import { subToPx } from '../render/camera';
import { h, layer } from '../ui';
import type { ActorView } from './scene';

/** Corrections, delays and intervals are summarised over this many recent samples. */
const WINDOW = 90;
/** Per-frame trace length (about 20 s at 60 fps). */
const MAX_FRAMES = 1200;
const MAX_KEYS = 400;
const OVERLAY_REFRESH_MS = 250;
/** Sent-input timestamps older than this are forgotten (the server never acked them). */
const SENT_TTL_MS = 5000;
const SNAPSHOT_MS = CONFIG.TICK_MS * CONFIG.SNAPSHOT_EVERY_TICKS;
const TILE_PX = 16;

export interface DrawnPoint {
  slot: number;
  x: number;
  y: number;
}

export interface FrameSample {
  /** requestAnimationFrame timestamp (same clock as KeyboardEvent.timeStamp). */
  t: number;
  /** Arena pixel position the local critter (or its duck) was drawn at, null when absent. */
  local: DrawnPoint | null;
  remote: DrawnPoint[];
  /** Server time the remote critters were interpolated at. */
  remoteTime: number;
}

export interface KeySample {
  t: number;
  code: string;
  type: 'down' | 'up';
}

export interface NetStatsReport {
  lagMs: number;
  rttMs: number;
  ackDelayMs: { last: number; avg: number; max: number };
  pendingInputs: number;
  correctionPx: { last: number; avg: number; p95: number; max: number; samples: number; snaps: number };
  interp: { depth: number; leadMs: number };
  snapshotIntervalMs: { mean: number; jitter: number; max: number; expected: number };
  fps: number;
}

class Ring {
  private values: number[] = [];

  constructor(private readonly cap: number) {}

  push(v: number): void {
    this.values.push(v);
    if (this.values.length > this.cap) this.values.shift();
  }

  get size(): number {
    return this.values.length;
  }

  get last(): number {
    return this.values.length ? this.values[this.values.length - 1] : 0;
  }

  mean(): number {
    return this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : 0;
  }

  max(): number {
    return this.values.reduce((a, b) => Math.max(a, b), 0);
  }

  /** Mean absolute deviation from the mean. */
  jitter(): number {
    const m = this.mean();
    return this.values.length ? this.values.reduce((a, b) => a + Math.abs(b - m), 0) / this.values.length : 0;
  }

  quantile(q: number): number {
    if (!this.values.length) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  }

  clear(): void {
    this.values = [];
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function drawn(a: ActorView): DrawnPoint {
  const p = a.duck ?? a;
  return { slot: a.slot, x: subToPx(p.x), y: subToPx(p.y) };
}

export class NetStats {
  /** Collecting samples (from ?netstats=1 or the first F3). */
  enabled = new URLSearchParams(window.location.search).get('netstats') === '1';
  /** Overlay shown while a match view is on screen (F3 toggles it). */
  private visible = this.enabled;
  private readonly sentAt = new Map<number, number>();
  private readonly ackDelays = new Ring(WINDOW);
  private readonly corrections = new Ring(WINDOW);
  private readonly intervals = new Ring(WINDOW);
  private readonly frameTimes = new Ring(60);
  private snaps = 0;
  private lastArrival = 0;
  private lastFrame = 0;
  private pending = 0;
  private interp = { depth: 0, leadMs: 0 };
  private frames: FrameSample[] = [];
  private keys: KeySample[] = [];
  private overlay: HTMLElement | null = null;
  private timer = 0;
  private attached = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, 'down'), true);
    window.addEventListener('keyup', (e) => this.onKey(e, 'up'), true);
    if (this.enabled) this.expose();
  }

  /** A match view is on screen: show the overlay (when enabled) and listen for F3. */
  attach(): void {
    this.attached = true;
    this.syncOverlay();
  }

  detach(): void {
    this.attached = false;
    this.syncOverlay();
  }

  /** An input left for the server (before any ?lag delay). */
  inputSent(seq: number, nowMs: number): void {
    if (!this.enabled) return;
    this.sentAt.set(seq, nowMs);
  }

  /** A snapshot was applied: its ack, the reconciliation correction and the buffer state. */
  snapshot(ack: number, nowMs: number, correctionUnits: number | null, snapped: boolean, pending: number, interp: { depth: number; leadMs: number }): void {
    if (!this.enabled) return;
    const sent = this.sentAt.get(ack);
    if (sent !== undefined) this.ackDelays.push(nowMs - sent);
    for (const [seq, at] of this.sentAt) if (seq <= ack || nowMs - at > SENT_TTL_MS) this.sentAt.delete(seq);
    if (correctionUnits !== null) this.corrections.push((correctionUnits * TILE_PX) / CONFIG.SUB);
    if (snapped) this.snaps += 1;
    if (this.lastArrival > 0) this.intervals.push(nowMs - this.lastArrival);
    this.lastArrival = nowMs;
    this.pending = pending;
    this.interp = interp;
  }

  /** New round: arrival intervals restart (the gap between rounds is not jitter). */
  roundStarted(): void {
    this.lastArrival = 0;
    this.sentAt.clear();
  }

  /** One rendered frame of the match view. */
  frame(nowMs: number, actors: readonly ActorView[], remoteTime: number): void {
    if (!this.enabled) return;
    if (this.lastFrame > 0) this.frameTimes.push(nowMs - this.lastFrame);
    this.lastFrame = nowMs;
    const local = actors.find((a) => a.local);
    const remote = actors.filter((a) => !a.local && (a.alive || a.duck)).map(drawn);
    this.frames.push({ t: nowMs, local: local ? drawn(local) : null, remote, remoteTime: Math.round(remoteTime * 10) / 10 });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  report(): NetStatsReport {
    const fpsMs = this.frameTimes.mean();
    return {
      lagMs: net.lagMs,
      rttMs: net.rtt,
      ackDelayMs: { last: Math.round(this.ackDelays.last), avg: Math.round(this.ackDelays.mean()), max: Math.round(this.ackDelays.max()) },
      pendingInputs: this.pending,
      correctionPx: {
        last: round1(this.corrections.last),
        avg: round1(this.corrections.mean()),
        p95: round1(this.corrections.quantile(0.95)),
        max: round1(this.corrections.max()),
        samples: this.corrections.size,
        snaps: this.snaps,
      },
      interp: { depth: this.interp.depth, leadMs: Math.round(this.interp.leadMs) },
      snapshotIntervalMs: { mean: round1(this.intervals.mean()), jitter: round1(this.intervals.jitter()), max: round1(this.intervals.max()), expected: round1(SNAPSHOT_MS) },
      fps: fpsMs > 0 ? Math.round(1000 / fpsMs) : 0,
    };
  }

  private onKey(e: KeyboardEvent, type: 'down' | 'up'): void {
    if (e.code === 'F3' && type === 'down' && this.attached) {
      e.preventDefault();
      if (!e.repeat) this.toggle();
      return;
    }
    if (!this.enabled || (type === 'down' && e.repeat)) return;
    this.keys.push({ t: e.timeStamp, code: e.code, type });
    if (this.keys.length > MAX_KEYS) this.keys.shift();
  }

  private toggle(): void {
    if (!this.enabled) {
      this.enabled = true;
      this.expose();
    }
    this.visible = !this.visible;
    this.syncOverlay();
  }

  /** Read-only handle for automated measurements (only once diagnostics were turned on). */
  private expose(): void {
    const self = this;
    Object.defineProperty(window, 'splashNetStats', {
      configurable: true,
      value: Object.freeze({
        report: () => self.report(),
        frames: (sinceMs = 0) => self.frames.filter((f) => f.t >= sinceMs),
        keys: (sinceMs = 0) => self.keys.filter((k) => k.t >= sinceMs),
        reset: () => self.resetSamples(),
      }),
    });
  }

  private resetSamples(): void {
    this.ackDelays.clear();
    this.corrections.clear();
    this.intervals.clear();
    this.snaps = 0;
    this.frames = [];
    this.keys = [];
  }

  private syncOverlay(): void {
    const show = this.visible && this.attached;
    if (show && !this.overlay) {
      this.overlay = h('pre', { class: 'net-stats', 'aria-hidden': 'true' });
      layer('badges').append(this.overlay);
      this.timer = window.setInterval(() => this.paint(), OVERLAY_REFRESH_MS);
      this.paint();
    } else if (!show && this.overlay) {
      window.clearInterval(this.timer);
      this.timer = 0;
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private paint(): void {
    if (!this.overlay) return;
    const r = this.report();
    const c = r.correctionPx;
    this.overlay.textContent = [
      `rtt ${r.rttMs}ms ack ${r.ackDelayMs.avg}ms pend ${r.pendingInputs}`,
      `corr ${c.last}/${c.p95}/${c.max}px${c.snaps ? ` ${c.snaps} snapped` : ''} ${r.fps}fps`,
      `buf ${r.interp.depth} +${r.interp.leadMs}ms snaps ${r.snapshotIntervalMs.mean}±${r.snapshotIntervalMs.jitter}ms`,
    ].join('\n');
  }
}

export const netStats = new NetStats();
