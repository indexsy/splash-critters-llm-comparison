// AudioContext lifecycle: lazy creation on the first user gesture (autoplay policy),
// resume/suspend around tab visibility, and the settings -> mixer bridge.
// Until unlock() succeeds there is no context and every consumer no-ops.
//
// resume() and suspend() land asynchronously (ctx.state flips later, and browsers differ on
// how much later), so `state` alone is stale while a request is in flight. The engine keeps
// the latest request it made and steers the context toward one target: running while the
// page is visible, suspended while it is hidden. When an older request lands after a newer
// one it re-steers, so a quick hide/show never leaves audio stuck in the wrong state.
import { createMixer, setMixLevels, type Mixer } from './mixer';
import type { AudioSettings } from './types';

type AudioContextCtor = typeof AudioContext;
type ContextTarget = 'running' | 'suspended';

interface ContextRequest {
  target: ContextTarget;
  pending: boolean;
  /** performance.now() when the request was made. */
  issuedAt: number;
}

const DEFAULT_SETTINGS: AudioSettings = { sfxVolume: 0.8, musicVolume: 0.5, muted: false };
/**
 * How long a resume may be in flight while SFX are still built for it. Sounds made during a
 * normal resume (the first gesture) play the moment the clock starts; a resume that has not
 * landed by then is probably blocked, and queuing more sounds would dump them all at once.
 */
const RESUME_GRACE_MS = 250;

function findAudioContext(): AudioContextCtor | null {
  const scope = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** iOS Safari only fully unlocks output after a buffer is started inside a gesture. */
function primeOutput(ctx: AudioContext): void {
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.addEventListener('ended', () => src.disconnect(), { once: true });
  src.start(0);
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };
  private pageHidden = false;
  private latest: ContextRequest | null = null;

  /** `onStateChange` fires whenever the context may have started or stopped running. */
  constructor(private readonly onStateChange: () => void) {}

  get ctx(): AudioContext | null {
    return this.context;
  }

  /** True only while the context's clock is running and the page is visible. */
  get running(): boolean {
    return this.context !== null && this.context.state === 'running' && !this.pageHidden;
  }

  /**
   * Whether sounds may be built now: running, or a resume made moments ago (e.g. by the
   * gesture that is also triggering this sound) is still landing.
   */
  get playable(): boolean {
    if (this.running) return true;
    const req = this.latest;
    return (
      this.context !== null &&
      this.context.state === 'suspended' &&
      !this.pageHidden &&
      req !== null &&
      req.pending &&
      req.target === 'running' &&
      performance.now() - req.issuedAt < RESUME_GRACE_MS
    );
  }

  get sfxBus(): GainNode | null {
    return this.mixer?.sfx ?? null;
  }

  get musicBus(): GainNode | null {
    return this.mixer?.music ?? null;
  }

  /** Whether an SFX would be heard at all (lets callers skip building silent graphs). */
  get sfxAudible(): boolean {
    return !this.settings.muted && this.settings.sfxVolume > 0;
  }

  /** Create or resume the context. Call from user gestures; repeated calls are cheap. */
  unlock(): void {
    const ctx = this.context ?? this.createContext();
    if (!ctx || this.pageHidden || ctx.state === 'closed') return;
    if (ctx.state === 'running') {
      this.reconcile();
      return;
    }
    // Ask again even if a resume is already in flight: only a call made inside a user
    // gesture is guaranteed to be allowed to start the clock.
    primeOutput(ctx);
    this.request('running');
  }

  applySettings(settings: AudioSettings): void {
    this.settings = { sfxVolume: settings.sfxVolume, musicVolume: settings.musicVolume, muted: settings.muted };
    if (this.context && this.mixer) setMixLevels(this.mixer, this.settings, this.context.currentTime);
  }

  /** Suspend output while the tab is hidden and resume it when it becomes visible again. */
  setPageHidden(hidden: boolean): void {
    if (hidden === this.pageHidden) return;
    this.pageHidden = hidden;
    this.reconcile();
  }

  private createContext(): AudioContext | null {
    const Ctor = findAudioContext();
    if (!Ctor) return null;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    this.context = ctx;
    this.mixer = createMixer(ctx);
    setMixLevels(this.mixer, this.settings, ctx.currentTime, true);
    ctx.addEventListener('statechange', () => {
      this.onStateChange();
      // The browser may also change state on its own (device change, OS interruption).
      this.reconcile();
    });
    return ctx;
  }

  /** Where the context is heading: the in-flight request's target, else its current state. */
  private heading(ctx: AudioContext): AudioContextState | ContextTarget {
    return this.latest?.pending ? this.latest.target : ctx.state;
  }

  /** Issue whatever request moves the context toward running-while-visible. */
  private reconcile(): void {
    const ctx = this.context;
    if (!ctx || ctx.state === 'closed') return;
    const target: ContextTarget = this.pageHidden ? 'suspended' : 'running';
    if (this.heading(ctx) !== target) this.request(target);
  }

  private request(target: ContextTarget): void {
    const ctx = this.context;
    if (!ctx) return;
    const req: ContextRequest = { target, pending: true, issuedAt: performance.now() };
    this.latest = req;
    const settled = () => {
      req.pending = false;
      this.onStateChange();
      // An older request landed after a newer one and may have undone it: steer back. The
      // latest request is never retried here, so a refused resume cannot loop.
      if (req !== this.latest) this.reconcile();
    };
    let op: Promise<void>;
    try {
      // Promise.resolve: some legacy WebKit contexts do not return a promise here.
      op = Promise.resolve(target === 'running' ? ctx.resume() : ctx.suspend());
    } catch (err) {
      op = Promise.reject(err);
    }
    op.then(settled, settled);
  }
}
