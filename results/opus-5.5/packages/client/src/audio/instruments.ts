// Music voices: chip pulse leads, triangle bass and a noise drum kit, rendered through the
// shared synth primitives into a track's output gain.
import { midiToFreq, type DrumHit } from './notes';
import type { PitchedInstrument } from './song';
import { noise, tone, type Sink, type Wave } from './synth';

const WAVE_FOR: Record<PitchedInstrument, Wave> = {
  pulse50: 'square',
  pulse25: 'pulse25',
  pulse12: 'pulse12',
  triangle: 'triangle',
};

/** Seconds per arpeggio note: roughly two NES frames, the classic chip "chord" buzz. */
const ARP_RATE = 1 / 30;
/** Notes at least this long (s) get a delayed vibrato. */
const VIBRATO_MIN_DUR = 0.34;

export function playNote(
  sink: Sink,
  inst: PitchedInstrument,
  midi: number,
  arp: number[] | null,
  at: number,
  dur: number,
  vol: number,
): void {
  const bass = inst === 'triangle';
  tone(sink, {
    wave: WAVE_FOR[inst],
    freq: midiToFreq(midi),
    at,
    dur,
    vol,
    attack: 0.003,
    decay: 0.18,
    sustain: bass ? 1 : 0.68,
    release: bass ? 0.025 : 0.045,
    arp: arp ? { semis: arp, rate: ARP_RATE } : undefined,
    vibrato: !arp && !bass && dur >= VIBRATO_MIN_DUR ? { rate: 5.5, cents: 16, delay: 0.14 } : undefined,
  });
}

export function playDrum(sink: Sink, hit: DrumHit, at: number, vol: number): void {
  switch (hit) {
    case 'k':
      tone(sink, {
        wave: 'triangle',
        freq: 165,
        slide: [[0.09, 42]],
        at,
        dur: 0.16,
        vol: vol * 1.2,
        attack: 0.001,
        sustain: 0.25,
        decay: 0.08,
        release: 0.05,
      });
      noise(sink, { at, dur: 0.018, vol: vol * 0.35, attack: 0.001, release: 0.01, filter: { type: 'lowpass', freq: 1600 } });
      return;
    case 's':
      noise(sink, {
        at,
        dur: 0.15,
        vol: vol * 0.9,
        attack: 0.001,
        sustain: 0.35,
        decay: 0.05,
        release: 0.06,
        filter: { type: 'bandpass', freq: 2400, q: 0.7 },
      });
      tone(sink, { wave: 'triangle', freq: 210, slide: [[0.06, 140]], at, dur: 0.07, vol: vol * 0.7, attack: 0.001, release: 0.03 });
      return;
    case 'h':
      noise(sink, { color: 'metal', rate: 1.6, at, dur: 0.035, vol: vol * 0.35, attack: 0.001, release: 0.02, filter: { type: 'highpass', freq: 6500 } });
      return;
    case 'o':
      noise(sink, {
        color: 'metal',
        rate: 1.4,
        at,
        dur: 0.16,
        vol: vol * 0.3,
        attack: 0.001,
        sustain: 0.5,
        decay: 0.06,
        release: 0.07,
        filter: { type: 'highpass', freq: 5500 },
      });
      return;
    case 'c':
      noise(sink, {
        at,
        dur: 0.7,
        vol: vol * 0.45,
        attack: 0.001,
        sustain: 0.3,
        decay: 0.15,
        release: 0.35,
        filter: { type: 'highpass', freq: 4200 },
      });
      return;
  }
}
