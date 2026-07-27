/**
 * The one AudioContext, its gain tree, and the tiny synth voices every sound in
 * the game is built from. Nothing here may throw: a browser that blocks or
 * lacks Web Audio must still play the game, just silently.
 *
 * Gain tree: voice -> (sfx | music) -> master -> destination.
 */

import { getSettings, onSettingsChange, updateSettings } from '../settings';

export type WaveKind = 'square' | 'triangle' | 'sawtooth' | 'sine';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let unavailable = false;
let noiseBuffer: AudioBuffer | null = null;

/** Master trim so a full-volume setting still leaves headroom for chords. */
const MASTER_TRIM = 0.5;

function createContext(): AudioContext | null {
  if (ctx) return ctx;
  if (unavailable) return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    const created = new Ctor();
    master = created.createGain();
    sfxBus = created.createGain();
    musicBus = created.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(created.destination);
    ctx = created;
    applyVolumes();
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

/**
 * Must be called from inside a user gesture. Safe to call repeatedly: it
 * creates the context once and resumes it whenever it has been suspended.
 */
export function initAudio(): void {
  const audio = createContext();
  if (!audio) return;
  if (audio.state === 'suspended') {
    void audio.resume().catch(() => {
      // Autoplay policy still says no; the next gesture will try again.
    });
  }
}

/** The live context, or null when audio is unavailable or not yet unlocked. */
export function audioContext(): AudioContext | null {
  return ctx;
}

export function sfxDestination(): GainNode | null {
  return sfxBus;
}

export function musicDestination(): GainNode | null {
  return musicBus;
}

/** Current context time, or 0 when there is no context. */
export function now(): number {
  return ctx ? ctx.currentTime : 0;
}

/** Re-reads the settings and pushes them onto the gain tree. */
export function applyVolumes(): void {
  if (!ctx || !master || !sfxBus || !musicBus) return;
  const settings = getSettings();
  const at = ctx.currentTime;
  const muted = settings.muted ? 0 : 1;
  setGain(master, MASTER_TRIM * muted, at);
  setGain(sfxBus, clamp01(settings.sfxVolume), at);
  setGain(musicBus, clamp01(settings.musicVolume), at);
}

/** Flips mute, persists it, and returns the new muted state. */
export function toggleMute(): boolean {
  const next = !getSettings().muted;
  // updateSettings notifies onSettingsChange, which calls applyVolumes for us.
  updateSettings({ muted: next });
  return next;
}

function setGain(node: GainNode, value: number, at: number): void {
  try {
    node.gain.cancelScheduledValues(at);
    node.gain.setTargetAtTime(value, at, 0.01);
  } catch {
    node.gain.value = value;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Sliders in the settings screen must take effect while a sound is playing.
onSettingsChange(() => applyVolumes());

// ------------------------------------------------------------------ envelopes

export interface ToneSpec {
  wave: WaveKind;
  /** Starting frequency in Hz. */
  freq: number;
  /** Optional glide target; the pitch ramps here across the note. */
  freqTo?: number;
  /** Exponential rather than linear pitch glide, which reads as more musical. */
  glideExp?: boolean;
  /** Peak gain, before the bus volumes. */
  gain: number;
  attack: number;
  /** Time from the peak down to the sustain level. */
  decay?: number;
  sustain?: number;
  /** Total note length excluding the release tail. */
  duration: number;
  release: number;
  /** Seconds from "now" before the note starts. */
  delay?: number;
  /** Overrides the sfx bus, used by the music scheduler. */
  destination?: GainNode | null;
  /** Absolute context time to start at; wins over `delay`. */
  at?: number;
  /** Optional band shaping, which is what makes the noise voices sound wet. */
  filter?: FilterSpec;
}

interface EnvelopeShape {
  gain: number;
  attack: number;
  decay?: number;
  sustain?: number;
  duration: number;
  release: number;
}

/** Applies an ADSR to `gain` and returns the absolute time the note ends. */
function envelope(shape: EnvelopeShape, gain: GainNode, start: number): number {
  const attack = Math.max(0.001, shape.attack);
  const decay = Math.max(0, shape.decay ?? 0);
  const sustain = shape.sustain ?? 1;
  const hold = Math.max(attack + decay, shape.duration);
  const end = start + hold + Math.max(0.005, shape.release);
  const level = Math.max(0.0001, shape.gain);
  const tail = Math.max(0.0001, level * (decay > 0 ? sustain : 1));
  const param = gain.gain;
  param.setValueAtTime(0.0001, start);
  param.linearRampToValueAtTime(level, start + attack);
  if (decay > 0) param.linearRampToValueAtTime(tail, start + attack + decay);
  param.setValueAtTime(tail, start + hold);
  param.exponentialRampToValueAtTime(0.0001, end);
  return end;
}

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  freqTo?: number;
  q?: number;
}

function makeFilter(
  spec: FilterSpec | undefined,
  audio: AudioContext,
  start: number,
  end: number,
): BiquadFilterNode | null {
  if (!spec) return null;
  const filter = audio.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q ?? 1;
  filter.frequency.setValueAtTime(Math.max(20, spec.freq), start);
  if (spec.freqTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqTo), end);
  }
  return filter;
}

/** Plays one oscillator note. Returns the time it finishes, or 0 if silent. */
export function tone(spec: ToneSpec): number {
  const audio = ctx;
  if (!audio) return 0;
  const bus = spec.destination === undefined ? sfxBus : spec.destination;
  if (!bus) return 0;
  try {
    const start = spec.at ?? audio.currentTime + (spec.delay ?? 0);
    const osc = audio.createOscillator();
    osc.type = spec.wave;
    osc.frequency.setValueAtTime(Math.max(20, spec.freq), start);
    const gain = audio.createGain();
    const end = envelope(spec, gain, start);
    if (spec.freqTo !== undefined) {
      const target = Math.max(20, spec.freqTo);
      if (spec.glideExp === false) osc.frequency.linearRampToValueAtTime(target, end);
      else osc.frequency.exponentialRampToValueAtTime(target, end);
    }
    const filter = makeFilter(spec.filter, audio, start, end);
    if (filter) {
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(bus);
    osc.start(start);
    osc.stop(end + 0.02);
    osc.onended = (): void => {
      gain.disconnect();
      filter?.disconnect();
    };
    return end;
  } catch {
    return 0;
  }
}

function whiteNoise(audio: AudioContext): AudioBuffer | null {
  if (noiseBuffer) return noiseBuffer;
  try {
    const length = Math.floor(audio.sampleRate * 1.0);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
    return buffer;
  } catch {
    return null;
  }
}

export interface NoiseSpec {
  gain: number;
  attack: number;
  duration: number;
  release: number;
  delay?: number;
  at?: number;
  destination?: GainNode | null;
  /** Playback rate shifts the noise colour; falling rates sound like water. */
  rate?: number;
  rateTo?: number;
  filter?: FilterSpec;
}

/** Plays one burst of filtered white noise. Returns its finish time, or 0. */
export function noise(spec: NoiseSpec): number {
  const audio = ctx;
  if (!audio) return 0;
  const bus = spec.destination === undefined ? sfxBus : spec.destination;
  if (!bus) return 0;
  const buffer = whiteNoise(audio);
  if (!buffer) return 0;
  try {
    const start = spec.at ?? audio.currentTime + (spec.delay ?? 0);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.setValueAtTime(spec.rate ?? 1, start);
    const gain = audio.createGain();
    const end = envelope(spec, gain, start);
    if (spec.rateTo !== undefined) {
      source.playbackRate.exponentialRampToValueAtTime(Math.max(0.05, spec.rateTo), end);
    }
    const filter = makeFilter(spec.filter, audio, start, end);
    if (filter) {
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(bus);
    source.start(start);
    source.stop(end + 0.02);
    source.onended = (): void => {
      gain.disconnect();
      filter?.disconnect();
    };
    return end;
  } catch {
    return 0;
  }
}

/** Equal-tempered note frequency. Semitones are relative to A4 = 440Hz. */
export function hz(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}
