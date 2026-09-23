import { describe, expect, it } from 'vitest';
import {
  barLengths,
  hz,
  midiToFreq,
  nextBarStep,
  noteToMidi,
  parseDrums,
  parseMelody,
  planTempoChange,
  rampScaleAt,
  stepSeconds,
  steadyTempo,
  tokenize,
} from '../src/audio/notes';
import { busLevels, volumeToGain } from '../src/audio/mixer';
import { compileSong } from '../src/audio/song';
import { SONGS } from '../src/audio/tracks';
import { VoicePool } from '../src/audio/voicePool';
import { pulseCoefficients, shortLfsrPeriod } from '../src/audio/waves';

describe('note names', () => {
  it('maps scientific pitch to MIDI and Hz', () => {
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('G#5')).toBe(80);
    expect(midiToFreq(69)).toBe(440);
    expect(hz('A5')).toBeCloseTo(880, 9);
    expect(hz('C4')).toBeCloseTo(261.6256, 3);
  });

  it('rejects malformed notes', () => {
    for (const bad of ['H4', 'C', 'c4', 'C##4', 'A10', '']) expect(() => noteToMidi(bad)).toThrow();
  });
});

describe('tokenize / parse', () => {
  it('drops bar lines and expands repeats', () => {
    expect(tokenize(' C4 . | -*3  h*2 ')).toEqual(['C4', '.', '-', '-', '-', 'h', 'h']);
    expect(() => tokenize('C4*0')).toThrow();
    expect(() => tokenize('C4*x')).toThrow();
  });

  it('parses holds, rests and arpeggios into timed events', () => {
    const p = parseMelody('C4 - - . E4 . - G4+47 -');
    expect(p.steps).toBe(9);
    expect(p.events).toEqual([
      { step: 0, len: 3, midi: 60, arp: null },
      { step: 4, len: 1, midi: 64, arp: null },
      { step: 7, len: 2, midi: 67, arp: [0, 4, 7] },
    ]);
    expect(parseMelody('D4+37a').events[0].arp).toEqual([0, 3, 7, 10]);
    expect(parseMelody('C4+47b').events[0].arp).toEqual([0, 4, 7, 11]);
    expect(() => parseMelody('C4+4z')).toThrow();
    expect(parseMelody('- - C4').events).toEqual([{ step: 2, len: 1, midi: 60, arp: null }]);
  });

  it('parses drum combos per step', () => {
    const d = parseDrums('kh . s - o | c');
    expect(d.steps).toBe(6);
    expect(d.events).toEqual([
      { step: 0, hits: ['k', 'h'] },
      { step: 2, hits: ['s'] },
      { step: 4, hits: ['o'] },
      { step: 5, hits: ['c'] },
    ]);
    expect(() => parseDrums('k x')).toThrow();
  });

  it('measures bars', () => {
    expect(barLengths('C4 -*15 | .*16')).toEqual([16, 16]);
    expect(barLengths('C4 . .')).toEqual([3]);
  });
});

describe('tempo math', () => {
  it('computes step length from bpm and scale', () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125, 12);
    expect(stepSeconds(150, 1.3)).toBeCloseTo(60 / 195 / 4, 12);
  });

  it('finds the next bar line', () => {
    expect(nextBarStep(0, 16)).toBe(0);
    expect(nextBarStep(1, 16)).toBe(16);
    expect(nextBarStep(16, 16)).toBe(16);
    expect(nextBarStep(17, 16)).toBe(32);
  });

  it('plans the showdown glide starting on the next bar', () => {
    const ramp = planTempoChange(steadyTempo(1), 21, 1.3, 16);
    expect(ramp).toMatchObject({ from: 1, to: 1.3, startStep: 32, steps: 16 });
    expect(rampScaleAt(ramp, 21)).toBe(1);
    expect(rampScaleAt(ramp, 32)).toBe(1);
    expect(rampScaleAt(ramp, 40)).toBeCloseTo(1.15, 12);
    expect(rampScaleAt(ramp, 48)).toBe(1.3);
    expect(rampScaleAt(ramp, 500)).toBe(1.3);
  });

  it('keeps the running glide until a reversal starts on the next bar line', () => {
    const up = planTempoChange(steadyTempo(1), 10, 1.3, 16); // glides over steps 16..32
    const down = planTempoChange(up, 24, 1, 16); // flipped back mid-glide
    expect(down).toMatchObject({ from: 1.3, to: 1, startStep: 32 });
    for (const s of [24, 25, 31]) expect(rampScaleAt(down, s)).toBeCloseTo(rampScaleAt(up, s), 12);
    expect(rampScaleAt(down, 40)).toBeCloseTo(1.15, 12);
    expect(rampScaleAt(down, 48)).toBe(1);
  });

  it('replaces a change still waiting for its bar line', () => {
    const up = planTempoChange(steadyTempo(1), 3, 1.3, 16);
    const cancelled = planTempoChange(up, 5, 1, 16);
    for (let s = 5; s < 64; s++) expect(rampScaleAt(cancelled, s)).toBe(1);
  });

  it('stays continuous under any toggle pattern, as the sequencer plays it', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 200; trial++) {
      let ramp = steadyTempo(1);
      let on = false;
      let prev = 1;
      let maxChange = 0;
      let [lo, hi] = [1, 1];
      for (let step = 0; step < 400; step++) {
        if (random() < 0.08) {
          on = !on;
          ramp = planTempoChange(ramp, step, on ? 1.3 : 1, 16);
          expect(ramp.startStep % 16).toBe(0);
          expect(ramp.prior?.prior ?? null).toBeNull(); // history never piles up
        }
        const scale = rampScaleAt(ramp, step);
        maxChange = Math.max(maxChange, Math.abs(scale - prev));
        [lo, hi] = [Math.min(lo, scale), Math.max(hi, scale)];
        prev = scale;
      }
      expect(maxChange).toBeLessThanOrEqual(0.3 / 16 + 1e-12);
      expect(lo).toBeGreaterThanOrEqual(1);
      expect(hi).toBeLessThanOrEqual(1.3);
      expect(rampScaleAt(ramp, 440)).toBe(on ? 1.3 : 1);
    }
  });
});

describe('song compilation', () => {
  it('rotates shifted channels and loops shorter channels', () => {
    const song = compileSong({
      bpm: 120,
      channels: [
        { inst: 'pulse25', vol: 0.1, notes: 'C4 - .*14 | .*16' },
        { inst: 'pulse12', vol: 0.1, notes: 'C4 - .*14 | .*16', shift: 3 },
        { inst: 'drums', vol: 0.1, hits: 'k .*15' },
      ],
    });
    expect(song.steps).toBe(32);
    expect(song.channels[0].at[0]).toMatchObject({ midi: 60, len: 2 });
    expect(song.channels[1].at[0]).toBeUndefined();
    expect(song.channels[1].at[3]).toMatchObject({ step: 3, midi: 60, len: 2 });
    expect(song.channels[2].steps).toBe(16);
    expect(song.showdownScale).toBe(1);
  });

  it('rejects miscounted bars and channels that do not divide the loop', () => {
    expect(() => compileSong({ bpm: 100, channels: [{ inst: 'triangle', vol: 1, notes: 'C3 .*14 | .*16' }] })).toThrow(/Bar 1/);
    expect(() =>
      compileSong({
        bpm: 100,
        channels: [
          { inst: 'triangle', vol: 1, notes: '.*48' },
          { inst: 'drums', vol: 1, hits: '.*32' },
        ],
      }),
    ).toThrow(/divide/);
    expect(() => compileSong({ bpm: 100, channels: [] })).toThrow();
  });

  it('compiles every soundtrack loop with sane ranges', () => {
    const leads = new Set<string>();
    for (const [name, def] of Object.entries(SONGS)) {
      const song = compileSong(def);
      expect(song.steps % 16, name).toBe(0);
      const kinds = def.channels.map((c) => c.inst);
      expect(kinds, name).toContain('triangle');
      expect(kinds, name).toContain('drums');
      expect(kinds.some((k) => k === 'pulse25' || k === 'pulse50'), name).toBe(true);
      const loopSeconds = song.steps * stepSeconds(song.bpm);
      expect(loopSeconds, name).toBeGreaterThan(4);
      expect(loopSeconds, name).toBeLessThan(40);
      for (const ch of song.channels) {
        if (ch.kind !== 'pitched') continue;
        for (const ev of ch.at) {
          if (!ev) continue;
          expect(ev.midi, name).toBeGreaterThanOrEqual(36);
          expect(ev.midi, name).toBeLessThanOrEqual(96);
        }
      }
      const lead = def.channels[0];
      if (lead.inst !== 'drums') leads.add(lead.notes);
    }
    expect(leads.size).toBe(Object.keys(SONGS).length);
    expect(compileSong(SONGS.battle).showdownScale).toBeCloseTo(1.3, 9);
  });
});

describe('VoicePool', () => {
  it('caps voices and steals the oldest of equal or lower priority', () => {
    const pool = new VoicePool<string>(3, 30);
    for (const [i, p] of [2, 0, 1].entries()) {
      const r = pool.request(`s${i}`, p, i * 100);
      expect(r).toEqual({ admit: true, evict: null });
      pool.add(`s${i}`, p, i * 100, `h${i}`);
    }
    expect(pool.size).toBe(3);
    expect(pool.request('low', 0, 1000)).toEqual({ admit: true, evict: 'h1' });
    pool.add('low', 0, 1000, 'hLow');
    expect(pool.request('ui', 0, 1100)).toEqual({ admit: true, evict: 'hLow' });
    pool.add('ui', 0, 1100, 'hUi');
    expect(pool.request('jingle', 3, 1200)).toEqual({ admit: true, evict: 'h0' });
    pool.add('jingle', 3, 1200, 'hJ');
    // Remaining: h2 (1), hUi (0), hJ (3): an ambient sound can steal the ambient one only.
    expect(pool.request('amb', 0, 1300)).toEqual({ admit: true, evict: 'hUi' });
    pool.add('amb', 0, 1300, 'hAmb');
    pool.release('hJ');
    pool.release('hJ');
    expect(pool.size).toBe(2);
  });

  it('refuses when full of higher-priority voices', () => {
    const pool = new VoicePool<number>(1, 30);
    pool.add('victory', 3, 0, 1);
    expect(pool.request('burst', 1, 500)).toEqual({ admit: false, reason: 'full' });
  });

  it('rate-limits identical sounds inside the window', () => {
    const pool = new VoicePool<number>(12, 30);
    pool.add('burst', 1, 1000, 1);
    expect(pool.request('burst', 1, 1029)).toEqual({ admit: false, reason: 'repeat' });
    expect(pool.request('drop', 0, 1010)).toEqual({ admit: true, evict: null });
    expect(pool.request('burst', 1, 1030)).toEqual({ admit: true, evict: null });
  });
});

describe('mix levels', () => {
  it('uses a clamped perceptual curve and mute silences the master', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(7)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
    const loud = busLevels({ sfxVolume: 1, musicVolume: 1, muted: false });
    expect(loud.master).toBe(1);
    expect(loud.music).toBeLessThan(loud.sfx);
    expect(busLevels({ sfxVolume: 1, musicVolume: 1, muted: true }).master).toBe(0);
  });
});

describe('chip waveforms', () => {
  it('a 50% pulse is a square wave (odd sine harmonics only)', () => {
    const { real, imag } = pulseCoefficients(0.5, 8);
    for (let n = 1; n <= 8; n++) {
      expect(Math.abs(real[n])).toBeLessThan(1e-6);
      if (n % 2 === 0) expect(Math.abs(imag[n])).toBeLessThan(1e-6);
      else expect(imag[n]).toBeCloseTo(2 / (Math.PI * n), 6);
    }
  });

  it('short-mode LFSR yields a 93-step two-level sequence', () => {
    const seq = shortLfsrPeriod();
    expect(seq).toHaveLength(93);
    expect(new Set(seq)).toEqual(new Set([1, -1]));
  });
});
