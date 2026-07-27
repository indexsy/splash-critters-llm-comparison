/**
 * Every one-shot sound in the game, composed from the square/triangle/noise
 * voices in context.ts. Each recipe is a plain function so the sounds can be
 * tuned in isolation without touching the dispatch table.
 */

import { hz, noise, now, tone } from './context';

export type SfxName =
  | 'drop'
  | 'burst'
  | 'pickup'
  | 'soak'
  | 'tide'
  | 'kick'
  | 'ui'
  | 'ui_back'
  | 'victory'
  | 'defeat'
  | 'countdown'
  | 'go'
  | 'level_up'
  | 'lob';

export type AnimalVoice = 'ribbit' | 'quack' | 'squeak' | 'honk' | 'meow' | 'chitter' | 'grunt';

// ------------------------------------------------------------------- recipes

/** Short descending square blip: a balloon hitting the ground. */
function drop(): void {
  tone({ wave: 'square', freq: 620, freqTo: 240, gain: 0.22, attack: 0.005, duration: 0.07, release: 0.04 });
}

/** Wet noise crack over a low triangle thump. */
function burst(): void {
  noise({
    gain: 0.3,
    attack: 0.002,
    duration: 0.09,
    release: 0.13,
    rate: 1.6,
    rateTo: 0.5,
    filter: { type: 'lowpass', freq: 5200, freqTo: 700, q: 0.9 },
  });
  tone({ wave: 'triangle', freq: 150, freqTo: 52, gain: 0.32, attack: 0.004, duration: 0.1, release: 0.14 });
}

/** Rising two-note jingle. */
function pickup(): void {
  tone({ wave: 'square', freq: hz(4), gain: 0.2, attack: 0.004, duration: 0.06, release: 0.03 });
  tone({ wave: 'square', freq: hz(11), gain: 0.2, attack: 0.004, duration: 0.09, release: 0.06, delay: 0.07 });
}

/** A falling sploosh: noise dragged down in pitch under a descending tone. */
function soak(): void {
  noise({
    gain: 0.34,
    attack: 0.006,
    duration: 0.22,
    release: 0.2,
    rate: 1.3,
    rateTo: 0.18,
    filter: { type: 'lowpass', freq: 3600, freqTo: 380, q: 1.4 },
  });
  tone({ wave: 'sine', freq: 460, freqTo: 90, gain: 0.18, attack: 0.008, duration: 0.26, release: 0.16 });
}

/** Two alternating low tones: the rising-tide alarm. */
function tide(): void {
  for (let i = 0; i < 2; i++) {
    const at = i * 0.34;
    tone({ wave: 'square', freq: hz(-17), gain: 0.2, attack: 0.01, duration: 0.16, release: 0.05, delay: at });
    tone({ wave: 'square', freq: hz(-22), gain: 0.2, attack: 0.01, duration: 0.16, release: 0.06, delay: at + 0.17 });
  }
}

/** Rubber boot thump. */
function kick(): void {
  tone({ wave: 'triangle', freq: 210, freqTo: 60, gain: 0.3, attack: 0.003, duration: 0.06, release: 0.07 });
  noise({ gain: 0.14, attack: 0.001, duration: 0.03, release: 0.03, rate: 0.7, filter: { type: 'lowpass', freq: 1600 } });
}

function uiBlip(): void {
  tone({ wave: 'square', freq: hz(7), gain: 0.13, attack: 0.002, duration: 0.028, release: 0.025 });
}

function uiBack(): void {
  tone({ wave: 'square', freq: hz(-2), gain: 0.13, attack: 0.002, duration: 0.034, release: 0.03 });
}

/** One countdown beep. The game screen fires this on 3, on 2 and on 1. */
function countdown(): void {
  tone({ wave: 'square', freq: hz(0), gain: 0.2, attack: 0.004, duration: 0.1, release: 0.06 });
}

/** The bright "SPLASH!" chord that releases the countdown. */
function go(): void {
  const chord = [hz(4), hz(9), hz(16)];
  chord.forEach((freq, i) => {
    tone({ wave: 'square', freq, gain: 0.17, attack: 0.005, duration: 0.24, release: 0.2, delay: i * 0.012 });
  });
  noise({ gain: 0.14, attack: 0.002, duration: 0.09, release: 0.14, rate: 1.4, rateTo: 0.6, filter: { type: 'highpass', freq: 900 } });
}

/** Short ascending fanfare. */
function victory(): void {
  const run = [hz(-8), hz(-1), hz(4), hz(11), hz(16)];
  run.forEach((freq, i) => {
    tone({ wave: 'square', freq, gain: 0.2, attack: 0.005, duration: 0.1, release: 0.08, delay: i * 0.11 });
    tone({ wave: 'triangle', freq: freq / 2, gain: 0.16, attack: 0.006, duration: 0.11, release: 0.09, delay: i * 0.11 });
  });
  tone({ wave: 'square', freq: hz(16), gain: 0.22, attack: 0.006, duration: 0.34, release: 0.3, delay: 0.55 });
}

/** Sad descending motif. */
function defeat(): void {
  const run = [hz(0), hz(-3), hz(-6), hz(-13)];
  run.forEach((freq, i) => {
    tone({ wave: 'triangle', freq, gain: 0.22, attack: 0.01, duration: 0.16, release: 0.12, delay: i * 0.17 });
  });
}

/** Ascending run for a level-up. */
function levelUp(): void {
  for (let i = 0; i < 6; i++) {
    tone({
      wave: 'square',
      freq: hz(-5 + i * 4),
      gain: 0.17,
      attack: 0.004,
      duration: 0.06,
      release: 0.05,
      delay: i * 0.06,
    });
  }
}

/** Soft whoosh as a revenge duck lobs a balloon. */
function lob(): void {
  noise({
    gain: 0.16,
    attack: 0.03,
    duration: 0.12,
    release: 0.1,
    rate: 0.5,
    rateTo: 1.5,
    filter: { type: 'bandpass', freq: 700, freqTo: 2200, q: 1.2 },
  });
}

const RECIPES: Record<SfxName, () => void> = {
  drop,
  burst,
  pickup,
  soak,
  tide,
  kick,
  ui: uiBlip,
  ui_back: uiBack,
  victory,
  defeat,
  countdown,
  go,
  level_up: levelUp,
  lob,
};

export function playSfx(name: SfxName): void {
  const recipe = RECIPES[name];
  if (!recipe) return;
  try {
    recipe();
  } catch {
    // A dead AudioContext must never take the frame loop down with it.
  }
}

// --------------------------------------------------------------- chain jingle

/** Semitone steps of the arpeggio, extended by repeating the top of the scale. */
const CHAIN_STEPS = [4, 9, 16, 21, 28, 33, 40];
/** Beyond this the jingle keeps adding notes but stops climbing. */
const CHAIN_PITCH_CAP = 40;

/**
 * Escalating arpeggio: two balloons gives two notes, three gives three, and it
 * keeps adding one note per extra balloon while capping how high it climbs.
 */
export function playChain(count: number): void {
  const notes = Math.min(8, Math.max(2, Math.floor(count)));
  try {
    for (let i = 0; i < notes; i++) {
      const step = Math.min(CHAIN_PITCH_CAP, CHAIN_STEPS[Math.min(i, CHAIN_STEPS.length - 1)]);
      // Brightness climbs with the chain: later notes get a longer, louder tail.
      tone({
        wave: 'square',
        freq: hz(step),
        gain: 0.15 + Math.min(0.08, i * 0.015),
        attack: 0.004,
        duration: 0.07,
        release: 0.07 + i * 0.01,
        delay: i * 0.075,
      });
    }
    tone({
      wave: 'triangle',
      freq: hz(-8),
      gain: 0.18,
      attack: 0.006,
      duration: 0.1 + notes * 0.03,
      release: 0.12,
    });
  } catch {
    // Ignore: audio is decorative.
  }
}

// ---------------------------------------------------------------- animal calls

interface VoiceStep {
  wave: 'square' | 'triangle' | 'sawtooth' | 'sine';
  from: number;
  to: number;
  gain: number;
  duration: number;
  at: number;
}

/**
 * Each species gets a distinct pitch envelope so players can tell who emoted
 * without looking. Frogs dip, ducks rasp, mice squeak high, and so on.
 */
const VOICES: Record<AnimalVoice, VoiceStep[]> = {
  ribbit: [
    { wave: 'sawtooth', from: 300, to: 150, gain: 0.2, duration: 0.09, at: 0 },
    { wave: 'sawtooth', from: 260, to: 120, gain: 0.2, duration: 0.11, at: 0.12 },
  ],
  quack: [
    { wave: 'sawtooth', from: 700, to: 380, gain: 0.19, duration: 0.13, at: 0 },
    { wave: 'sawtooth', from: 520, to: 300, gain: 0.14, duration: 0.08, at: 0.15 },
  ],
  squeak: [
    { wave: 'square', from: 1500, to: 2400, gain: 0.12, duration: 0.06, at: 0 },
    { wave: 'square', from: 2200, to: 1300, gain: 0.12, duration: 0.06, at: 0.07 },
  ],
  honk: [
    { wave: 'square', from: 220, to: 320, gain: 0.2, duration: 0.16, at: 0 },
    { wave: 'square', from: 300, to: 190, gain: 0.16, duration: 0.12, at: 0.18 },
  ],
  meow: [
    { wave: 'sawtooth', from: 620, to: 980, gain: 0.16, duration: 0.12, at: 0 },
    { wave: 'sawtooth', from: 980, to: 520, gain: 0.16, duration: 0.2, at: 0.13 },
  ],
  chitter: [
    { wave: 'square', from: 1200, to: 1500, gain: 0.1, duration: 0.03, at: 0 },
    { wave: 'square', from: 1400, to: 1100, gain: 0.1, duration: 0.03, at: 0.05 },
    { wave: 'square', from: 1300, to: 1600, gain: 0.1, duration: 0.03, at: 0.1 },
    { wave: 'square', from: 1500, to: 1050, gain: 0.1, duration: 0.03, at: 0.15 },
  ],
  grunt: [
    { wave: 'triangle', from: 190, to: 110, gain: 0.26, duration: 0.16, at: 0 },
  ],
};

export function playEmote(voice: AnimalVoice): void {
  const steps = VOICES[voice];
  if (!steps) return;
  const base = now();
  try {
    for (const step of steps) {
      tone({
        wave: step.wave,
        freq: step.from,
        freqTo: step.to,
        gain: step.gain,
        attack: 0.006,
        duration: step.duration,
        release: 0.05,
        at: base + step.at,
      });
    }
  } catch {
    // Ignore.
  }
}
