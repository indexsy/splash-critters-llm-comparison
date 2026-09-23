// Song definitions (compact note strings) compiled into step-indexed lookup tables that
// the sequencer can read in O(1) per step. Pure: no Web Audio, unit-tested under Node.
import { barLengths, parseDrums, parseMelody, type DrumHit, type NoteEvent } from './notes';

export type PitchedInstrument = 'pulse50' | 'pulse25' | 'pulse12' | 'triangle';

export type ChannelDef =
  | {
      inst: PitchedInstrument;
      /** Peak gain of this channel's notes (before the music bus). */
      vol: number;
      notes: string;
      /** Rotate the pattern later by this many steps (echo channels reuse the lead line). */
      shift?: number;
    }
  | { inst: 'drums'; vol: number; hits: string };

export interface SongDef {
  bpm: number;
  /** Steps per bar, 16 by default (4/4 in 16th notes). Tempo changes land on bar lines. */
  barSteps?: number;
  /** Fraction of a step that odd steps are delayed by (0 = straight, ~0.2 = shuffle). */
  swing?: number;
  /** Tempo multiplier used while the showdown flag is on (battle only). */
  showdownScale?: number;
  channels: ChannelDef[];
}

export type CompiledChannel =
  | { kind: 'pitched'; inst: PitchedInstrument; vol: number; steps: number; at: (NoteEvent | undefined)[] }
  | { kind: 'drums'; vol: number; steps: number; at: (DrumHit[] | undefined)[] };

export interface CompiledSong {
  bpm: number;
  barSteps: number;
  swing: number;
  showdownScale: number;
  /** Loop length in steps: the longest channel; shorter channels loop inside it. */
  steps: number;
  channels: CompiledChannel[];
}

/**
 * When a pattern is written with "|" bar lines, every bar must be exactly one bar long so
 * a miscounted bar fails loudly (unbarred patterns only need a whole number of bars).
 */
function checkBars(src: string, barSteps: number): void {
  if (!src.includes('|')) return;
  const lengths = barLengths(src);
  const bad = lengths.findIndex((n) => n !== barSteps);
  if (bad >= 0) throw new Error(`Bar ${bad + 1} has ${lengths[bad]} steps, expected ${barSteps}`);
}

function compilePitched(def: Extract<ChannelDef, { notes: string }>): CompiledChannel {
  const pattern = parseMelody(def.notes);
  const at: (NoteEvent | undefined)[] = new Array(pattern.steps).fill(undefined);
  const shift = def.shift ?? 0;
  for (const ev of pattern.events) {
    const step = (ev.step + shift) % pattern.steps;
    at[step] = { ...ev, step };
  }
  return { kind: 'pitched', inst: def.inst, vol: def.vol, steps: pattern.steps, at };
}

function compileDrums(def: Extract<ChannelDef, { hits: string }>): CompiledChannel {
  const pattern = parseDrums(def.hits);
  const at: (DrumHit[] | undefined)[] = new Array(pattern.steps).fill(undefined);
  for (const ev of pattern.events) at[ev.step] = ev.hits;
  return { kind: 'drums', vol: def.vol, steps: pattern.steps, at };
}

/** Compile and validate a song. Throws if a channel does not fit the bar grid or the loop. */
export function compileSong(def: SongDef): CompiledSong {
  const barSteps = def.barSteps ?? 16;
  for (const ch of def.channels) checkBars(ch.inst === 'drums' ? ch.hits : ch.notes, barSteps);
  const channels = def.channels.map((ch) => (ch.inst === 'drums' ? compileDrums(ch) : compilePitched(ch)));
  if (channels.length === 0) throw new Error('Song has no channels');
  const steps = Math.max(...channels.map((ch) => ch.steps));
  for (const ch of channels) {
    if (ch.steps === 0 || ch.steps % barSteps !== 0) {
      throw new Error(`Channel length ${ch.steps} is not a whole number of ${barSteps}-step bars`);
    }
    if (steps % ch.steps !== 0) throw new Error(`Channel length ${ch.steps} does not divide loop ${steps}`);
  }
  return {
    bpm: def.bpm,
    barSteps,
    swing: def.swing ?? 0,
    showdownScale: def.showdownScale ?? 1,
    steps,
    channels,
  };
}
