// Pure music helpers: compact note-string parsing and tempo math.
// No Web Audio in here, so it runs (and is unit-tested) under Node.
//
// Note-string grammar (one whitespace-separated token per step, 16 steps = one 4/4 bar):
//   C4, F#5, Bb3   note on (scientific pitch, A4 = 440 Hz)
//   C4+47          note with a fast chip arpeggio over semitone offsets 0,4,7
//                  (offset digits 0-9 and a-c for 10-12, e.g. G3+47a = dominant 7th)
//   -              hold the previous note one more step (a rest stays a rest)
//   .              rest (ends the previous note)
//   |              bar separator, ignored (readability only)
//   tok*n          repeat a token n times (".*8", "-*15", "h*4")
// Drum strings use the same layout, where a token is one or more hit letters played
// together on that step: k kick, s snare, h closed hat, o open hat, c crash ("kh" = kick+hat).

export const STEPS_PER_BEAT = 4;

export interface NoteEvent {
  /** Step index (0-based) inside the pattern. */
  step: number;
  /** Length in steps (>= 1). */
  len: number;
  midi: number;
  /** Arpeggio semitone offsets, always starting with 0; null for a plain note. */
  arp: number[] | null;
}

export type DrumHit = 'k' | 's' | 'h' | 'o' | 'c';

export interface DrumEvent {
  step: number;
  hits: DrumHit[];
}

export interface Pattern<E> {
  /** Total length in steps (including trailing rests). */
  steps: number;
  events: E[];
}

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-G])([#b]?)(\d)$/;
const ARP_RE = /^[0-9a-c]+$/;
const DRUM_LETTERS = new Set<string>(['k', 's', 'h', 'o', 'c']);

/** "A4" -> 69. Throws on malformed input so bad track data fails loudly in tests. */
export function noteToMidi(name: string): number {
  const m = NOTE_RE.exec(name);
  if (!m) throw new Error(`Bad note "${name}"`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + NOTE_BASE[m[1]] + accidental;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Frequency of a note name: hz("A4") === 440. */
export function hz(name: string): number {
  return midiToFreq(noteToMidi(name));
}

/** Split a pattern string into step tokens, dropping bar lines and expanding "tok*n". */
export function tokenize(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.split(/\s+/)) {
    if (raw === '' || raw === '|') continue;
    const star = raw.lastIndexOf('*');
    if (star <= 0) {
      out.push(raw);
      continue;
    }
    const count = Number(raw.slice(star + 1));
    if (!Number.isInteger(count) || count < 1) throw new Error(`Bad repeat "${raw}"`);
    const tok = raw.slice(0, star);
    for (let i = 0; i < count; i++) out.push(tok);
  }
  return out;
}

/** Step count of each "|"-separated bar in a pattern string (for validating track data). */
export function barLengths(src: string): number[] {
  return src.split('|').map((bar) => tokenize(bar).length);
}

function parseArp(spec: string, token: string): number[] {
  if (!ARP_RE.test(spec)) throw new Error(`Bad arpeggio "${token}"`);
  return [0, ...Array.from(spec, (ch) => parseInt(ch, 16))];
}

function parseNoteToken(token: string): { midi: number; arp: number[] | null } {
  const plus = token.indexOf('+');
  if (plus < 0) return { midi: noteToMidi(token), arp: null };
  return { midi: noteToMidi(token.slice(0, plus)), arp: parseArp(token.slice(plus + 1), token) };
}

/** Parse a melodic note string into timed note events. */
export function parseMelody(src: string): Pattern<NoteEvent> {
  const tokens = tokenize(src);
  const events: NoteEvent[] = [];
  let current: NoteEvent | null = null;
  tokens.forEach((tok, step) => {
    if (tok === '.') {
      current = null;
    } else if (tok === '-') {
      if (current) current.len++;
    } else {
      const { midi, arp } = parseNoteToken(tok);
      current = { step, len: 1, midi, arp };
      events.push(current);
    }
  });
  return { steps: tokens.length, events };
}

/** Parse a drum string ("k . h . s . h .") into per-step hit lists. */
export function parseDrums(src: string): Pattern<DrumEvent> {
  const tokens = tokenize(src);
  const events: DrumEvent[] = [];
  tokens.forEach((tok, step) => {
    if (tok === '.' || tok === '-') return;
    const hits: DrumHit[] = [];
    for (const ch of tok) {
      if (!DRUM_LETTERS.has(ch)) throw new Error(`Bad drum token "${tok}"`);
      hits.push(ch as DrumHit);
    }
    events.push({ step, hits });
  });
  return { steps: tokens.length, events };
}

// ---- tempo math -------------------------------------------------------------------

/** Seconds per 16th-note step at `bpm`, sped up by `scale` (1.3 = 30% faster). */
export function stepSeconds(bpm: number, scale = 1): number {
  return 60 / (bpm * scale) / STEPS_PER_BEAT;
}

/** First bar boundary at or after `step`. */
export function nextBarStep(step: number, barSteps: number): number {
  return Math.ceil(step / barSteps) * barSteps;
}

/**
 * A linear tempo-scale change from `from` to `to` over `steps` steps starting at `startStep`.
 * Before `startStep` the `prior` curve (the glide this one is queued behind) stays in effect,
 * so a change requested mid-glide never makes the tempo jump.
 */
export interface TempoRamp {
  from: number;
  to: number;
  startStep: number;
  steps: number;
  prior: TempoRamp | null;
}

export function steadyTempo(scale: number): TempoRamp {
  return { from: scale, to: scale, startStep: 0, steps: 0, prior: null };
}

export function rampScaleAt(ramp: TempoRamp, step: number): number {
  if (step < ramp.startStep && ramp.prior) return rampScaleAt(ramp.prior, step);
  if (step <= ramp.startStep) return ramp.from;
  if (ramp.steps <= 0 || step >= ramp.startStep + ramp.steps) return ramp.to;
  return ramp.from + ((ramp.to - ramp.from) * (step - ramp.startStep)) / ramp.steps;
}

/**
 * Plan a tempo change toward `target` that begins on the next bar boundary at or after
 * `nextStep` (the next step still to be scheduled) and glides over one bar. Until then the
 * current curve keeps playing (even mid-glide), and the new glide starts from wherever that
 * curve is at the boundary, so the tempo is continuous. A change still waiting for the same
 * bar line is simply replaced.
 */
export function planTempoChange(
  current: TempoRamp,
  nextStep: number,
  target: number,
  barSteps: number,
): TempoRamp {
  const startStep = nextBarStep(nextStep, barSteps);
  return {
    from: rampScaleAt(current, startStep),
    to: target,
    startStep,
    steps: barSteps,
    prior: curveUntil(current, nextStep),
  };
}

/**
 * The part of `ramp` still needed from `nextStep` on, with history the sequencer can no
 * longer reach dropped, so repeated changes never grow a chain of priors.
 */
function curveUntil(ramp: TempoRamp, nextStep: number): TempoRamp | null {
  // A change that has not started yet is being replaced: keep what plays before it.
  if (ramp.startStep > nextStep) return ramp.prior;
  return ramp.prior ? { ...ramp, prior: null } : ramp;
}
