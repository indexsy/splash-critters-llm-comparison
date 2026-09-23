// Low-level synth primitives shared by SFX recipes and the music instruments.
// Every call builds a short-lived node chain (source -> [filter] -> envelope gain -> sink),
// schedules it on the AudioContext clock and disconnects the whole chain when the source
// ends, so nothing leaks no matter how many sounds are fired.
import { midiToFreq, type NoteEvent, type Pattern } from './notes';
import { noiseBuffer, pulseWave, type NoiseColor } from './waves';

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine' | 'pulse25' | 'pulse12';

/** Where a sound is built: a context, an output node and an optional source tracker. */
export interface Sink {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  /** Called for every source node so the owner (an SFX voice) can count and stop it. */
  track?(src: AudioScheduledSourceNode): void;
}

/** Automation path as [secondsAfterStart, hz] points reached by exponential ramps. */
export type Slide = ReadonlyArray<readonly [number, number]>;

export interface Env {
  /** Linear rise time to `vol` (s). */
  attack?: number;
  /** Time for the level to settle toward `sustain` (s). */
  decay?: number;
  /** Sustain level as a fraction of `vol` (1 = no decay). */
  sustain?: number;
  /** Fade-out time at the end of `dur` (s). */
  release?: number;
}

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  slide?: Slide;
}

export interface ToneSpec extends Env {
  wave: Wave;
  freq: number;
  /** Start time on the context clock. */
  at: number;
  /** Total length including the release (s). */
  dur: number;
  /** Peak gain. */
  vol: number;
  slide?: Slide;
  detune?: number;
  vibrato?: { rate: number; cents: number; delay?: number };
  /** Cycle the pitch over semitone offsets every `rate` seconds (chip arpeggio). */
  arp?: { semis: readonly number[]; rate: number };
  filter?: FilterSpec;
}

export interface NoiseSpec extends Env {
  color?: NoiseColor;
  at: number;
  dur: number;
  vol: number;
  /** Playback rate of the noise buffer (pitch of metallic noise, colour of white noise). */
  rate?: number;
  filter?: FilterSpec;
}

const DEFAULT_ATTACK = 0.004;
const DEFAULT_RELEASE = 0.03;
const MIN_FREQ = 1;

/** Apply an attack/decay/release envelope to a gain param; returns the stop time. */
function applyEnvelope(gain: AudioParam, env: Env, at: number, dur: number, vol: number): number {
  const attack = Math.min(env.attack ?? DEFAULT_ATTACK, dur / 2);
  const release = Math.min(env.release ?? DEFAULT_RELEASE, dur / 2);
  const sustain = env.sustain ?? 1;
  gain.setValueAtTime(0, at);
  gain.linearRampToValueAtTime(vol, at + attack);
  if (sustain < 1) gain.setTargetAtTime(vol * sustain, at + attack, (env.decay ?? 0.1) / 3);
  const releaseStart = Math.max(at + attack, at + dur - release);
  gain.setTargetAtTime(0, releaseStart, release / 5);
  return releaseStart + release;
}

function applySlide(param: AudioParam, from: number, at: number, slide: Slide | undefined): void {
  param.setValueAtTime(Math.max(MIN_FREQ, from), at);
  let last = at;
  for (const [dt, value] of slide ?? []) {
    const t = Math.max(last + 0.001, at + dt);
    param.exponentialRampToValueAtTime(Math.max(MIN_FREQ, value), t);
    last = t;
  }
}

function applyArp(param: AudioParam, base: number, at: number, stop: number, arp: NonNullable<ToneSpec['arp']>): void {
  const rate = Math.max(0.01, arp.rate);
  let k = 0;
  for (let t = at; t < stop; t += rate, k++) {
    param.setValueAtTime(base * Math.pow(2, arp.semis[k % arp.semis.length] / 12), t);
  }
}

function makeFilter(ctx: BaseAudioContext, spec: FilterSpec, at: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q ?? 1;
  applySlide(filter.frequency, spec.freq, at, spec.slide);
  return filter;
}

function makeOscillator(ctx: BaseAudioContext, wave: Wave): OscillatorNode {
  const osc = ctx.createOscillator();
  if (wave === 'pulse25') osc.setPeriodicWave(pulseWave(ctx, 0.25));
  else if (wave === 'pulse12') osc.setPeriodicWave(pulseWave(ctx, 0.125));
  else osc.type = wave;
  return osc;
}

/** Register the source with the sink and tear the chain down once it has ended. */
function own(sink: Sink, src: AudioScheduledSourceNode, chain: AudioNode[]): void {
  src.addEventListener(
    'ended',
    () => {
      for (const node of chain) node.disconnect();
    },
    { once: true },
  );
  sink.track?.(src);
}

/** Connect nodes in order and finally into the sink. */
function wire(nodes: AudioNode[], sink: Sink): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  nodes[nodes.length - 1].connect(sink.out);
}

/** One oscillator note with envelope, optional pitch slide/arp/vibrato and filter. */
export function tone(sink: Sink, spec: ToneSpec): void {
  const { ctx } = sink;
  const osc = makeOscillator(ctx, spec.wave);
  const amp = ctx.createGain();
  const stop = applyEnvelope(amp.gain, spec, spec.at, spec.dur, spec.vol);
  if (spec.arp) {
    osc.frequency.setValueAtTime(spec.freq, spec.at);
    applyArp(osc.frequency, spec.freq, spec.at, stop, spec.arp);
  } else {
    applySlide(osc.frequency, spec.freq, spec.at, spec.slide);
  }
  if (spec.detune) osc.detune.setValueAtTime(spec.detune, spec.at);

  const chain: AudioNode[] = [osc];
  if (spec.filter) chain.push(makeFilter(ctx, spec.filter, spec.at));
  chain.push(amp);
  wire(chain, sink);

  if (spec.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const onset = spec.at + (spec.vibrato.delay ?? 0);
    lfo.frequency.value = spec.vibrato.rate;
    depth.gain.setValueAtTime(0, spec.at);
    depth.gain.setValueAtTime(0, onset);
    depth.gain.linearRampToValueAtTime(spec.vibrato.cents, onset + 0.08);
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(spec.at);
    lfo.stop(stop);
    chain.push(lfo, depth);
  }
  osc.start(spec.at);
  osc.stop(stop);
  own(sink, osc, chain);
}

/** A burst of (optionally filtered) noise with an envelope. */
export function noise(sink: Sink, spec: NoiseSpec): void {
  const { ctx } = sink;
  const color = spec.color ?? 'white';
  const src = ctx.createBufferSource();
  const buffer = noiseBuffer(ctx, color);
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = spec.rate ?? 1;
  const amp = ctx.createGain();
  const stop = applyEnvelope(amp.gain, spec, spec.at, spec.dur, spec.vol);

  const chain: AudioNode[] = [src];
  if (spec.filter) chain.push(makeFilter(ctx, spec.filter, spec.at));
  chain.push(amp);
  wire(chain, sink);

  const offset = color === 'white' ? Math.random() * buffer.duration * 0.9 : 0;
  src.start(spec.at, offset);
  src.stop(stop);
  own(sink, src, chain);
}

export interface MelodyOptions extends Env {
  wave: Wave;
  at: number;
  /** Seconds per step. */
  step: number;
  vol: number;
  /** Fraction of each note's length that sounds (legato 1, staccato ~0.5). */
  gate?: number;
  transpose?: number;
  vibrato?: ToneSpec['vibrato'];
}

/** Play a parsed note pattern once (jingles); returns the time the pattern ends. */
export function melody(sink: Sink, pattern: Pattern<NoteEvent>, opts: MelodyOptions): number {
  const gate = opts.gate ?? 0.9;
  for (const ev of pattern.events) {
    tone(sink, {
      ...opts,
      freq: midiToFreq(ev.midi + (opts.transpose ?? 0)),
      at: opts.at + ev.step * opts.step,
      dur: Math.max(0.03, ev.len * opts.step * gate),
      arp: ev.arp ? { semis: ev.arp, rate: 0.035 } : undefined,
      vibrato: ev.len >= 4 ? opts.vibrato : undefined,
    });
  }
  return opts.at + pattern.steps * opts.step;
}

/** Random pitch multiplier within +/- `semis` semitones (variation for repeated SFX). */
export function vary(semis: number): number {
  return Math.pow(2, ((Math.random() * 2 - 1) * semis) / 12);
}
