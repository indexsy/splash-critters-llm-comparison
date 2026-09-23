// A strict in-memory stand-in for the Web Audio API, used to test the audio graph in Node.
// It mirrors the real API's failure modes (non-finite automation values, exponential ramps
// to <= 0, double start, stop before start) and records the connection graph so tests can
// prove every finished voice is disconnected. Like real browsers, resume() and suspend()
// only change `state` (and fire 'statechange') in a later task, in call order; set
// `immediateSuspend` to model Chrome, whose suspend() flips `state` during the call.

export class FakeParam {
  value: number;
  readonly events: Array<{ kind: string; value: number; time: number }> = [];

  constructor(initial: number) {
    this.value = initial;
  }

  private record(kind: string, value: number, time: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time)) throw new TypeError(`${kind}: non-finite ${value} @ ${time}`);
    if (time < 0) throw new RangeError(`${kind}: negative time ${time}`);
    this.events.push({ kind, value, time });
    this.value = value;
    return this;
  }

  setValueAtTime(v: number, t: number): this {
    return this.record('set', v, t);
  }
  linearRampToValueAtTime(v: number, t: number): this {
    return this.record('linear', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (v <= 0) throw new RangeError(`exponential ramp to ${v}`);
    return this.record('exp', v, t);
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    if (!Number.isFinite(tc) || tc < 0) throw new RangeError(`bad time constant ${tc}`);
    return this.record('target', v, t);
  }
  cancelScheduledValues(t: number): this {
    if (!Number.isFinite(t)) throw new TypeError('cancel: non-finite');
    return this;
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode | FakeParam>();
  readonly inputs = new Set<FakeNode>();

  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: string,
  ) {
    ctx.created.push(this);
  }

  connect<T extends FakeNode | FakeParam>(dest: T): T {
    this.outputs.add(dest);
    if (dest instanceof FakeNode) dest.inputs.add(this);
    return dest;
  }

  disconnect(): void {
    for (const out of this.outputs) if (out instanceof FakeNode) out.inputs.delete(this);
    this.outputs.clear();
  }
}

export class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  ended = false;
  private readonly endedListeners: Array<() => void> = [];

  start(when = 0, offset = 0): void {
    if (this.startTime !== null) throw new Error('InvalidStateError: start called twice');
    if (!Number.isFinite(when) || when < 0 || !Number.isFinite(offset) || offset < 0) throw new RangeError('bad start');
    this.startTime = when;
    this.ctx.sources.push(this);
  }

  stop(when = 0): void {
    if (this.startTime === null) throw new Error('InvalidStateError: stop before start');
    if (!Number.isFinite(when) || when < 0) throw new RangeError('bad stop');
    if (!this.ended) this.stopTime = when;
  }

  addEventListener(type: string, cb: () => void): void {
    if (type === 'ended') this.endedListeners.push(cb);
  }

  /** Time the source stops by itself (a one-shot buffer running out), if ever. */
  naturalEnd(): number | null {
    return null;
  }

  fireEnded(): void {
    this.ended = true;
    for (const cb of this.endedListeners.splice(0)) cb();
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  periodic = false;
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  setPeriodicWave(): void {
    this.periodic = true;
  }
}

class FakeBufferSource extends FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);

  override naturalEnd(): number | null {
    return !this.loop && this.buffer && this.startTime !== null ? this.startTime + this.buffer.duration : null;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

type ContextState = 'suspended' | 'running' | 'closed';

/** Resolves in a later macrotask (not faked by vitest's timer mocks). */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** Model Chrome: suspend() flips `state` synchronously and resolves at once. */
  static immediateSuspend = false;
  currentTime = 0;
  readonly sampleRate = 48000;
  state: ContextState = 'suspended';
  /** resume()/suspend() calls whose state change has not landed yet. */
  pendingControl = 0;
  readonly created: FakeNode[] = [];
  readonly sources: FakeSource[] = [];
  readonly destination: FakeNode;
  private readonly stateListeners: Array<() => void> = [];
  private controlTail: Promise<void> = Promise.resolve();

  constructor() {
    this.destination = new FakeNode(this, 'destination');
    FakeAudioContext.instances.push(this);
  }

  addEventListener(type: string, cb: () => void): void {
    if (type === 'statechange') this.stateListeners.push(cb);
  }

  private setState(state: 'suspended' | 'running'): void {
    const changed = this.state !== state;
    this.state = state;
    if (changed) for (const cb of this.stateListeners) cb();
  }

  /** Queue a control message: it lands in a later task, after every earlier one. */
  private control(state: 'suspended' | 'running'): Promise<void> {
    this.pendingControl++;
    const landed = this.controlTail.then(nextTask).then(() => {
      this.pendingControl--;
      this.setState(state);
    });
    this.controlTail = landed;
    return landed;
  }

  resume(): Promise<void> {
    return this.control('running');
  }

  suspend(): Promise<void> {
    if (!FakeAudioContext.immediateSuspend) return this.control('suspended');
    this.setState('suspended');
    return Promise.resolve();
  }

  createGain(): FakeGain {
    return new FakeGain(this, 'gain');
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this, 'osc');
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this, 'buffer');
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this, 'filter');
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this, 'panner');
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this, 'compressor');
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array): object {
    if (real.length !== imag.length) throw new Error('periodic wave length mismatch');
    return {};
  }
  createBuffer(channels: number, length: number, rate: number): { duration: number; getChannelData(i: number): Float32Array } {
    if (length < 1) throw new Error('NotSupportedError: empty buffer');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / rate, getChannelData: (i: number) => data[i] };
  }

  /** Advance the audio clock (only while running) and fire 'ended' on finished sources. */
  advance(seconds: number): void {
    if (this.state === 'running') this.currentTime += seconds;
    for (const src of this.sources) {
      if (src.ended) continue;
      const ends = [src.stopTime, src.naturalEnd()].filter((t): t is number => t !== null);
      if (ends.length > 0 && Math.min(...ends) <= this.currentTime) src.fireEnded();
    }
  }

  /** Nodes that still have outgoing connections. */
  connectedNodes(): FakeNode[] {
    return this.created.filter((n) => n.outputs.size > 0);
  }
}
