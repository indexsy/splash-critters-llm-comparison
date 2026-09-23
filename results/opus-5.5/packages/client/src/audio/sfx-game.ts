// Arena sound effects: balloons, chains, power-ups, kicks, the rising tide and duck lobs.
import { hz, midiToFreq, noteToMidi } from './notes';
import { noise, tone, vary, type Sink } from './synth';
import { PRIORITY, type SfxDef } from './types';

type GameSfx = 'drop' | 'burst' | 'chain' | 'pickup' | 'reveal' | 'kick' | 'tide_alarm' | 'tide_step' | 'revenge_lob';

/** Major-chord climb used by chain jingles (semitones above the root). */
const CHAIN_SHAPE = [0, 4, 7, 12, 16, 19, 24, 28];
const CHAIN_ROOT = noteToMidi('C5');
const PICKUP_ROOT = noteToMidi('G5');
const PICKUP_SHAPE = [0, 4, 7, 12, 16];

/** Soft plop: a quick upward sine-ish blip with a whisper of low noise. */
function drop(v: Sink, at: number): void {
  tone(v, { wave: 'triangle', freq: 190, slide: [[0.07, 540]], at, dur: 0.1, vol: 0.34, attack: 0.002, release: 0.05 });
  noise(v, { at, dur: 0.05, vol: 0.06, filter: { type: 'lowpass', freq: 1100 } });
}

/** Punchy pop: filtered noise crack + sub thump + spray, randomly pitched each time. */
function burst(v: Sink, at: number, level: number): void {
  const p = vary(3);
  const size = Math.min(1.5, 1 + Math.max(0, level - 1) * 0.08);
  noise(v, {
    at,
    dur: 0.3 * size,
    vol: 0.55,
    attack: 0.001,
    sustain: 0.28,
    decay: 0.07,
    release: 0.12,
    filter: { type: 'lowpass', freq: 4200 * p, q: 1.3, slide: [[0.24 * size, 260 * p]] },
  });
  tone(v, {
    wave: 'square',
    freq: 170 * p,
    slide: [[0.11, 46]],
    at,
    dur: 0.13,
    vol: 0.3,
    attack: 0.001,
    sustain: 0.5,
    decay: 0.05,
    release: 0.04,
    filter: { type: 'lowpass', freq: 1300 },
  });
  noise(v, { at: at + 0.03, dur: 0.2 * size, vol: 0.11, sustain: 0.3, decay: 0.06, release: 0.08, filter: { type: 'highpass', freq: 3200 * p } });
}

/**
 * Escalating chain jingle. 2 = DOUBLE (3-note climb), 3 = TRIPLE (4 notes, a step higher),
 * 4+ keeps climbing: more notes, higher root, faster run, longer finale with a sparkle arp.
 */
function chain(v: Sink, at: number, level: number): void {
  const lv = Math.max(2, Math.min(8, Math.round(level)));
  const root = CHAIN_ROOT + (lv - 2) * 2;
  const count = Math.min(CHAIN_SHAPE.length, lv + 1);
  const step = Math.max(0.04, 0.062 - (lv - 2) * 0.005);
  for (let i = 0; i < count; i++) {
    tone(v, { wave: 'pulse25', freq: midiToFreq(root + CHAIN_SHAPE[i]), at: at + i * step, dur: step * 1.05, vol: 0.17, release: 0.02 });
  }
  const finale = at + count * step;
  const hold = 0.16 + (lv - 2) * 0.06;
  tone(v, {
    wave: 'pulse25',
    freq: midiToFreq(root + 12),
    at: finale,
    dur: hold,
    vol: 0.19,
    release: 0.08,
    vibrato: { rate: 7, cents: 25, delay: 0.05 },
  });
  tone(v, { wave: 'triangle', freq: midiToFreq(root - 12), at, dur: finale - at + hold, vol: 0.26, release: 0.06 });
  if (lv >= 3) {
    tone(v, { wave: 'pulse12', freq: midiToFreq(root + 16), at: finale, dur: hold, vol: 0.08, release: 0.08 });
  }
  if (lv >= 4) {
    tone(v, {
      wave: 'pulse12',
      freq: midiToFreq(root + 24),
      at: finale,
      dur: hold + 0.1,
      vol: 0.07,
      release: 0.1,
      arp: { semis: [0, 4, 7, 12], rate: 0.03 },
    });
    noise(v, { at: finale, dur: 0.35, vol: 0.06, sustain: 0.4, decay: 0.1, release: 0.2, filter: { type: 'highpass', freq: 6000 } });
  }
}

/** Rising arpeggio with a held top note. */
function pickup(v: Sink, at: number): void {
  const step = 0.042;
  PICKUP_SHAPE.forEach((semi, i) => {
    const last = i === PICKUP_SHAPE.length - 1;
    tone(v, {
      wave: 'pulse25',
      freq: midiToFreq(PICKUP_ROOT + semi),
      at: at + i * step,
      dur: last ? 0.14 : step,
      vol: 0.15,
      release: last ? 0.07 : 0.015,
    });
  });
  tone(v, { wave: 'triangle', freq: midiToFreq(PICKUP_ROOT - 12), at, dur: 0.3, vol: 0.14, release: 0.08 });
}

/** A power-up peeking out of a washed castle: a soft shimmering two-note ding. */
function reveal(v: Sink, at: number): void {
  tone(v, { wave: 'pulse12', freq: hz('E6'), at, dur: 0.07, vol: 0.09, release: 0.02 });
  tone(v, { wave: 'sine', freq: hz('B6'), at: at + 0.06, dur: 0.22, vol: 0.1, release: 0.12, vibrato: { rate: 9, cents: 30 } });
}

/** Balloon kicked: a short rubbery "thwup" with a toe tap. */
function kick(v: Sink, at: number): void {
  tone(v, { wave: 'square', freq: 290, slide: [[0.06, 140]], at, dur: 0.08, vol: 0.16, attack: 0.001, release: 0.03, filter: { type: 'lowpass', freq: 1800 } });
  noise(v, { at, dur: 0.03, vol: 0.1, attack: 0.001, filter: { type: 'highpass', freq: 2200 } });
}

/** Rising tide warning: a two-cycle siren over a lower drone. */
function tideAlarm(v: Sink, at: number): void {
  const siren: Array<[number, number]> = [
    [0.3, 940],
    [0.6, 620],
    [0.9, 940],
    [1.2, 620],
  ];
  tone(v, { wave: 'pulse25', freq: 620, slide: siren, at, dur: 1.25, vol: 0.17, attack: 0.02, release: 0.1 });
  tone(v, {
    wave: 'triangle',
    freq: 310,
    slide: siren.map(([t, f]) => [t, f / 2] as [number, number]),
    at,
    dur: 1.25,
    vol: 0.2,
    attack: 0.02,
    release: 0.1,
  });
}

/** One ring of the tide advancing: a low surging gurgle. */
function tideStep(v: Sink, at: number): void {
  noise(v, {
    at,
    dur: 0.5,
    vol: 0.2,
    attack: 0.05,
    release: 0.2,
    filter: { type: 'lowpass', freq: 300, q: 3, slide: [[0.18, 1400], [0.45, 280]] },
  });
  tone(v, { wave: 'triangle', freq: 115, slide: [[0.3, 70]], at, dur: 0.35, vol: 0.16, release: 0.12 });
}

/** A duck lobs a revenge balloon: a rising whistle and an airy whoosh. */
function revengeLob(v: Sink, at: number): void {
  tone(v, { wave: 'sine', freq: 480, slide: [[0.24, 1450]], at, dur: 0.28, vol: 0.13, release: 0.08, vibrato: { rate: 11, cents: 35 } });
  noise(v, {
    at,
    dur: 0.26,
    vol: 0.1,
    attack: 0.04,
    release: 0.1,
    filter: { type: 'bandpass', freq: 800, q: 2, slide: [[0.24, 2600]] },
  });
}

export const GAME_SFX: Record<GameSfx, SfxDef> = {
  drop: { priority: PRIORITY.ambient, play: drop },
  burst: { priority: PRIORITY.action, play: burst },
  chain: { priority: PRIORITY.important, play: chain },
  pickup: { priority: PRIORITY.action, play: pickup },
  reveal: { priority: PRIORITY.ambient, play: reveal },
  kick: { priority: PRIORITY.ambient, play: kick },
  tide_alarm: { priority: PRIORITY.important, play: tideAlarm },
  tide_step: { priority: PRIORITY.ambient, play: tideStep },
  revenge_lob: { priority: PRIORITY.action, play: revengeLob },
};
