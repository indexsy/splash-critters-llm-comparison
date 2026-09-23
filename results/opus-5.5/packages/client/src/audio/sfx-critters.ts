// Critter voices: the soak "sploosh", the cat's melodramatic yowl and the four animal emotes,
// all faked with oscillators, filters and noise.
import { noise, tone, vary, type Sink } from './synth';
import { PRIORITY, type SfxDef } from './types';

type CritterSfx = 'soak' | 'soak_cat' | 'emote_quack' | 'emote_ribbit' | 'emote_squeak' | 'emote_honk';

const BUBBLES = 4;

/** Noise wash through a closing lowpass + a falling tone, then a few rising bubble blips. */
function sploosh(v: Sink, at: number, scale: number): void {
  noise(v, {
    at,
    dur: 0.55 * scale,
    vol: 0.5,
    attack: 0.002,
    sustain: 0.35,
    decay: 0.12,
    release: 0.2,
    filter: { type: 'lowpass', freq: 5200, q: 2, slide: [[0.45 * scale, 220]] },
  });
  tone(v, {
    wave: 'square',
    freq: 660,
    slide: [[0.45 * scale, 105]],
    at,
    dur: 0.5 * scale,
    vol: 0.15,
    sustain: 0.6,
    decay: 0.2,
    release: 0.1,
    filter: { type: 'lowpass', freq: 1800 },
  });
  for (let i = 0; i < BUBBLES; i++) {
    const t = at + 0.18 * scale + i * 0.07 + Math.random() * 0.03;
    const f = 450 + Math.random() * 550;
    tone(v, { wave: 'sine', freq: f, slide: [[0.045, f * 1.9]], at: t, dur: 0.055, vol: 0.11, attack: 0.002, release: 0.03 });
  }
}

/** "Mrrr-OWWW": a sawtooth through a sweeping vowel formant, rising then collapsing. */
function yowl(v: Sink, at: number): void {
  const pitch: Array<[number, number]> = [
    [0.12, 700],
    [0.38, 830],
    [0.62, 330],
  ];
  tone(v, {
    wave: 'sawtooth',
    freq: 380,
    slide: pitch,
    at,
    dur: 0.68,
    vol: 0.22,
    attack: 0.03,
    release: 0.12,
    vibrato: { rate: 9, cents: 45, delay: 0.1 },
    filter: { type: 'bandpass', freq: 700, q: 4, slide: [[0.15, 1700], [0.45, 1400], [0.62, 600]] },
  });
  tone(v, {
    wave: 'pulse25',
    freq: 760,
    slide: pitch.map(([t, f]) => [t, f * 2] as [number, number]),
    at,
    dur: 0.68,
    vol: 0.05,
    attack: 0.03,
    release: 0.12,
    filter: { type: 'lowpass', freq: 2600 },
  });
}

/** Nasal square through a bandpass with a pitch dip, plus a tiny "q" consonant click. */
function quack(v: Sink, at: number): void {
  const p = vary(1);
  tone(v, {
    wave: 'square',
    freq: 640 * p,
    slide: [[0.05, 470 * p], [0.17, 520 * p]],
    at,
    dur: 0.21,
    vol: 0.24,
    attack: 0.004,
    sustain: 0.7,
    decay: 0.08,
    release: 0.05,
    filter: { type: 'bandpass', freq: 1500, q: 3.5, slide: [[0.17, 900]] },
  });
  noise(v, { at, dur: 0.03, vol: 0.12, attack: 0.001, filter: { type: 'bandpass', freq: 2200, q: 2 } });
}

/** A frog croak: a rapid roll of tiny pulse blips over a low body tone. */
function croak(v: Sink, at: number, freq: number, pulses: number): void {
  const gap = 0.022;
  for (let i = 0; i < pulses; i++) {
    tone(v, {
      wave: 'pulse25',
      freq: freq * (1 + i * 0.03),
      at: at + i * gap,
      dur: 0.017,
      vol: 0.22,
      attack: 0.001,
      release: 0.006,
      filter: { type: 'lowpass', freq: 1400 },
    });
  }
  tone(v, { wave: 'triangle', freq: freq / 2, at, dur: pulses * gap, vol: 0.16, release: 0.02 });
}

function ribbit(v: Sink, at: number): void {
  croak(v, at, 215, 4);
  croak(v, at + 0.15, 170, 6);
}

/** High chirp sweep up-and-down, then a smaller second squeak. */
function squeak(v: Sink, at: number): void {
  const p = vary(1);
  tone(v, { wave: 'pulse12', freq: 1900 * p, slide: [[0.06, 3300 * p], [0.11, 2500 * p]], at, dur: 0.12, vol: 0.12, release: 0.03 });
  tone(v, { wave: 'sine', freq: 2200 * p, slide: [[0.05, 3600 * p]], at: at + 0.15, dur: 0.07, vol: 0.1, release: 0.02 });
}

/** Low, detuned square pair through a lowpass that sags in pitch: a goose honk. */
function honk(v: Sink, at: number): void {
  for (const detune of [-18, 18]) {
    tone(v, {
      wave: 'square',
      freq: 235,
      slide: [[0.05, 250], [0.34, 205]],
      detune,
      at,
      dur: 0.36,
      vol: 0.16,
      attack: 0.02,
      sustain: 0.8,
      decay: 0.1,
      release: 0.06,
      filter: { type: 'lowpass', freq: 1300, q: 2 },
    });
  }
  noise(v, { at, dur: 0.05, vol: 0.06, attack: 0.002, filter: { type: 'bandpass', freq: 900, q: 1.5 } });
}

export const CRITTER_SFX: Record<CritterSfx, SfxDef> = {
  soak: { priority: PRIORITY.important, play: (v, at) => sploosh(v, at, 1) },
  soak_cat: {
    priority: PRIORITY.important,
    play: (v, at) => {
      yowl(v, at);
      sploosh(v, at + 0.3, 1.25);
    },
  },
  emote_quack: { priority: PRIORITY.action, play: quack },
  emote_ribbit: { priority: PRIORITY.action, play: ribbit },
  emote_squeak: { priority: PRIORITY.action, play: squeak },
  emote_honk: { priority: PRIORITY.action, play: honk },
};
