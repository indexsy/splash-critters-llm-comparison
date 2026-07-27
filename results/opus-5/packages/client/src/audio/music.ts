/**
 * The chiptune layer: one looping track per screen, scheduled with a lookahead
 * against AudioContext.currentTime so tempo never drifts with the event loop.
 *
 * A track is a grid of sixteenth-note steps with three parts: a triangle bass,
 * a square lead and a noise percussion line. Patterns are written as semitone
 * offsets from A4 (see hz()), with null meaning "rest".
 */

import { audioContext, hz, musicDestination, noise, tone } from './context';

export type MusicTrack = 'title' | 'menu' | 'battle' | 'showdown' | 'results';

type Step = number | null;

interface TrackDef {
  /** Beats per minute of the quarter note. */
  bpm: number;
  /** Sixteenth-note patterns. All three must share a length. */
  bass: Step[];
  lead: Step[];
  /** 0 = silence, 1 = soft hat, 2 = accent. */
  perc: number[];
  /** Per-track mix trim so tracks sit at a similar loudness. */
  gain: number;
  /** Lead wave, which is most of a track's character. */
  leadWave: 'square' | 'triangle';
}

const R: Step = null;

/**
 * Patterns are 32 sixteenths (two bars) so a loop has room to breathe without
 * costing much scheduling work.
 */
const TRACKS: Record<MusicTrack, TrackDef> = {
  title: {
    bpm: 104,
    gain: 0.5,
    leadWave: 'square',
    bass: [-20, R, R, R, -13, R, R, R, -20, R, R, R, -13, R, R, R,
           -18, R, R, R, -11, R, R, R, -18, R, R, R, -13, R, R, R],
    lead: [4, R, 9, R, 11, R, 9, R, 4, R, R, R, 2, R, R, R,
           6, R, 11, R, 13, R, 11, R, 6, R, R, R, 4, R, R, R],
    perc: [2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 1,
           2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 1],
  },
  menu: {
    bpm: 96,
    gain: 0.42,
    leadWave: 'triangle',
    bass: [-20, R, -20, R, -15, R, R, R, -18, R, -18, R, -13, R, R, R,
           -20, R, -20, R, -15, R, R, R, -17, R, -17, R, -13, R, R, R],
    lead: [R, R, 4, R, 7, R, R, R, 9, R, R, R, 7, R, 4, R,
           R, R, 2, R, 7, R, R, R, 11, R, R, R, 9, R, 7, R],
    perc: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
           0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
  },
  battle: {
    bpm: 138,
    gain: 0.44,
    leadWave: 'square',
    bass: [-20, R, -20, -8, -20, R, -20, -8, -18, R, -18, -6, -18, R, -18, -6,
           -15, R, -15, -3, -15, R, -15, -3, -18, R, -18, -6, -20, R, -13, R],
    lead: [4, R, R, 7, 9, R, 7, R, 6, R, R, 9, 11, R, 9, R,
           4, R, R, 11, 9, R, 7, R, 6, R, 4, R, 2, R, R, R],
    perc: [2, 0, 1, 0, 2, 1, 1, 0, 2, 0, 1, 0, 2, 1, 1, 0,
           2, 0, 1, 0, 2, 1, 1, 0, 2, 0, 1, 0, 2, 1, 2, 2],
  },
  showdown: {
    bpm: 168,
    gain: 0.46,
    leadWave: 'square',
    bass: [-20, -20, -8, R, -20, -20, -8, R, -18, -18, -6, R, -18, -18, -6, R,
           -22, -22, -10, R, -22, -22, -10, R, -18, -18, -6, R, -13, R, -13, R],
    lead: [16, R, 14, R, 11, R, 14, R, 16, R, 18, R, 16, R, 14, R,
           11, R, 9, R, 11, R, 14, R, 16, R, R, 18, 21, R, R, R],
    perc: [2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2,
           2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 2, 2, 2],
  },
  results: {
    bpm: 110,
    gain: 0.45,
    leadWave: 'square',
    bass: [-20, R, R, R, -15, R, R, R, -13, R, R, R, -15, R, R, R,
           -20, R, R, R, -13, R, R, R, -18, R, R, R, -20, R, R, R],
    lead: [9, R, 11, R, 13, R, R, R, 16, R, R, R, 13, R, 11, R,
           9, R, 13, R, 16, R, R, R, 20, R, R, R, 16, R, R, R],
    perc: [2, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 1, 0, 1, 0,
           2, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 1, 1, 1, 1],
  },
};

/** How far ahead notes are queued, and how often the queue is topped up. */
const LOOKAHEAD_SEC = 0.2;
const TIMER_MS = 40;
/** Tempo changes glide instead of snapping, so a speed-up does not stutter. */
const SPEED_GLIDE = 0.08;

let current: MusicTrack | null = null;
let trackGain: GainNode | null = null;
let timer = 0;
/** Step index within the pattern, and the context time that step begins. */
let step = 0;
let nextNoteTime = 0;
let speed = 1;
let targetSpeed = 1;
/** Track requested before the context existed, started once audio unlocks. */
let pending: MusicTrack | null = null;

function stepDuration(def: TrackDef): number {
  // 60 / bpm is a quarter note; a step is a sixteenth.
  return 60 / def.bpm / 4 / Math.max(0.25, speed);
}

function scheduleStep(def: TrackDef, index: number, at: number): void {
  const dest = trackGain;
  if (!dest) return;
  const stepSec = stepDuration(def);

  const bass = def.bass[index];
  if (bass !== null && bass !== undefined) {
    tone({
      wave: 'triangle',
      freq: hz(bass),
      gain: 0.3 * def.gain,
      attack: 0.005,
      duration: stepSec * 0.85,
      release: 0.05,
      at,
      destination: dest,
    });
  }

  const lead = def.lead[index];
  if (lead !== null && lead !== undefined) {
    tone({
      wave: def.leadWave,
      freq: hz(lead),
      gain: 0.2 * def.gain,
      attack: 0.006,
      decay: stepSec * 0.4,
      sustain: 0.6,
      duration: stepSec * 0.9,
      release: 0.06,
      at,
      destination: dest,
    });
  }

  const hit = def.perc[index] ?? 0;
  if (hit > 0) {
    const accent = hit >= 2;
    noise({
      gain: (accent ? 0.16 : 0.07) * def.gain,
      attack: 0.001,
      duration: accent ? 0.05 : 0.02,
      release: accent ? 0.06 : 0.03,
      rate: accent ? 0.8 : 2.2,
      filter: { type: accent ? 'lowpass' : 'highpass', freq: accent ? 2200 : 4000 },
      at,
      destination: dest,
    });
  }
}

function pump(): void {
  const audio = audioContext();
  if (!audio || !current) return;
  const def = TRACKS[current];
  const horizon = audio.currentTime + LOOKAHEAD_SEC;
  // If the tab was backgrounded the clock ran on without us; resync rather than
  // firing a burst of stale notes.
  if (nextNoteTime < audio.currentTime - 0.5) nextNoteTime = audio.currentTime;

  let guard = 0;
  while (nextNoteTime < horizon && guard++ < 256) {
    // Ease toward the requested tempo one step at a time.
    speed += (targetSpeed - speed) * SPEED_GLIDE;
    scheduleStep(def, step, nextNoteTime);
    nextNoteTime += stepDuration(def);
    step = (step + 1) % def.bass.length;
  }
}

/** Starts a track, or does nothing when that track is already playing. */
export function startMusic(track: MusicTrack): void {
  if (current === track) return;
  const audio = audioContext();
  if (!audio) {
    // The title screen asks for music before the player has clicked anything.
    // Remember it and let initAudio start it the moment the context exists.
    pending = track;
    return;
  }
  stopMusic();
  const bus = musicDestination();
  if (!bus) return;
  try {
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.linearRampToValueAtTime(1, audio.currentTime + 0.08);
    gain.connect(bus);
    trackGain = gain;
    current = track;
    step = 0;
    speed = targetSpeed;
    nextNoteTime = audio.currentTime + 0.06;
    pump();
    timer = window.setInterval(pump, TIMER_MS);
  } catch {
    current = null;
    trackGain = null;
  }
}

/** Starts a track that was requested before the AudioContext existed. */
export function flushPendingMusic(): void {
  const track = pending;
  if (!track) return;
  pending = null;
  startMusic(track);
}

/** Stops the current track and releases its nodes. */
export function stopMusic(): void {
  pending = null;
  if (timer) {
    window.clearInterval(timer);
    timer = 0;
  }
  current = null;
  step = 0;
  const gain = trackGain;
  trackGain = null;
  if (!gain) return;
  const audio = audioContext();
  try {
    if (audio) {
      // Fade rather than cut so already-scheduled notes do not click.
      gain.gain.cancelScheduledValues(audio.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, audio.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    }
    window.setTimeout(() => gain.disconnect(), 400);
  } catch {
    try {
      gain.disconnect();
    } catch {
      // Already detached.
    }
  }
}

/** 1.0 is the track's written tempo; the glide makes the change smooth. */
export function setMusicSpeed(multiplier: number): void {
  if (!Number.isFinite(multiplier)) return;
  targetSpeed = Math.min(2, Math.max(0.5, multiplier));
}
