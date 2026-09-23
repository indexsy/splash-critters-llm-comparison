// Short musical stingers: round countdown, round/match outcomes, matchmaking and level-ups.
// Multi-voice jingles are written in the same note-string grammar as the music.
import { hz, parseMelody } from './notes';
import { melody, noise, tone, type Sink } from './synth';
import { PRIORITY, type SfxDef } from './types';

type JingleSfx = 'countdown' | 'go' | 'round_win' | 'round_lose' | 'victory' | 'defeat' | 'draw' | 'match_found' | 'level_up';

const ROUND_WIN = {
  lead: parseMelody('C5 E5 G5 C6 - - - .'),
  harmony: parseMelody('E4 G4 C5 E5 - - - .'),
  bass: parseMelody('C3 - - - G2 - C3 .'),
};
const ROUND_LOSE = parseMelody('G4 - . F#4 - . F4 - . E4 - - - - - -');
const VICTORY = {
  lead: parseMelody('C5 . C5 E5 G5 - E5 G5 | C6 - - - B5 - C6 - | D6 - - - C6 D6 E6 - | C6 - - - - - - -'),
  harmony: parseMelody('E4 . E4 G4 C5 - G4 C5 | E5 - - - D5 - E5 - | F5 - - - E5 F5 G5 - | E5 - - - - - - -'),
  bass: parseMelody('C3 . C3 . C3 . C3 . | A2 . A2 . A2 . A2 . | G2 . G2 . G2 . G2 . | C3 - - - - - - -'),
};
const DEFEAT = {
  lead: parseMelody('E5 - D5 - C5 - B4 - | A4 - - - G#4 - - - | A4 - - - - - - -'),
  bass: parseMelody('A2 - - - - - - - | F2 - - - E2 - - - | A2 - - - - - - -'),
};
const DRAW = parseMelody('G4 . C5 . G4 . . . F4 - - - - - . .');
const MATCH_FOUND = parseMelody('E5 G#5 B5 E6 - . B5 E6 - - -');
const LEVEL_UP_RUN = parseMelody('C5 D5 E5 F5 G5 A5 B5 C6');

/** One beep per second of the round intro countdown (the higher "go" chord follows it). */
function countdown(v: Sink, at: number): void {
  tone(v, { wave: 'pulse25', freq: hz('A5'), at, dur: 0.14, vol: 0.2, release: 0.04 });
  tone(v, { wave: 'triangle', freq: hz('A4'), at, dur: 0.14, vol: 0.18, release: 0.04 });
}

/** Round start: a bright arpeggiated chord and a splash of crash. */
function go(v: Sink, at: number): void {
  tone(v, { wave: 'pulse25', freq: hz('C6'), at, dur: 0.5, vol: 0.18, release: 0.15, arp: { semis: [0, 4, 7, 12], rate: 0.035 } });
  tone(v, { wave: 'triangle', freq: hz('C4'), at, dur: 0.5, vol: 0.24, release: 0.15 });
  noise(v, { at, dur: 0.45, vol: 0.08, sustain: 0.4, decay: 0.1, release: 0.25, filter: { type: 'highpass', freq: 5000 } });
}

function roundWin(v: Sink, at: number): void {
  const step = 0.07;
  melody(v, ROUND_WIN.lead, { wave: 'pulse25', at, step, vol: 0.17 });
  melody(v, ROUND_WIN.harmony, { wave: 'pulse12', at, step, vol: 0.08 });
  melody(v, ROUND_WIN.bass, { wave: 'triangle', at, step, vol: 0.24 });
}

/** A deflating "wah wah wah waaah". */
function roundLose(v: Sink, at: number): void {
  melody(v, ROUND_LOSE, {
    wave: 'square',
    at,
    step: 0.075,
    vol: 0.14,
    gate: 0.85,
    release: 0.06,
    vibrato: { rate: 6, cents: 40, delay: 0.1 },
  });
}

/** Match won: a four-bar fanfare with harmony, bass and a closing crash. */
function victory(v: Sink, at: number): void {
  const step = 0.085;
  const end = melody(v, VICTORY.lead, { wave: 'pulse25', at, step, vol: 0.17, vibrato: { rate: 6, cents: 18, delay: 0.12 } });
  melody(v, VICTORY.harmony, { wave: 'pulse12', at, step, vol: 0.08 });
  melody(v, VICTORY.bass, { wave: 'triangle', at, step, vol: 0.26 });
  noise(v, { at: end - 8 * step, dur: 0.8, vol: 0.09, sustain: 0.35, decay: 0.15, release: 0.4, filter: { type: 'highpass', freq: 4500 } });
}

/** Match lost: a slow, sulky descent ending on a wobbly low note. */
function defeat(v: Sink, at: number): void {
  const step = 0.1;
  melody(v, DEFEAT.lead, { wave: 'square', at, step, vol: 0.13, release: 0.08, vibrato: { rate: 5, cents: 35, delay: 0.15 } });
  melody(v, DEFEAT.bass, { wave: 'triangle', at, step, vol: 0.22, release: 0.08 });
}

/** Nobody won: an unresolved shrug. */
function draw(v: Sink, at: number): void {
  melody(v, DRAW, { wave: 'pulse25', at, step: 0.09, vol: 0.15, vibrato: { rate: 5, cents: 25, delay: 0.1 } });
  tone(v, { wave: 'triangle', freq: hz('D3'), at, dur: 1.2, vol: 0.14, release: 0.3 });
}

function matchFound(v: Sink, at: number): void {
  melody(v, MATCH_FOUND, { wave: 'pulse25', at, step: 0.055, vol: 0.16 });
  melody(v, MATCH_FOUND, { wave: 'pulse12', at: at + 0.02, step: 0.055, vol: 0.06, transpose: 12 });
  tone(v, { wave: 'triangle', freq: hz('E3'), at, dur: 0.55, vol: 0.2, release: 0.15 });
}

/** Scale run into a sparkling arpeggiated chord. */
function levelUp(v: Sink, at: number): void {
  const step = 0.042;
  const end = melody(v, LEVEL_UP_RUN, { wave: 'pulse25', at, step, vol: 0.15, gate: 1 });
  tone(v, { wave: 'pulse25', freq: hz('C6'), at: end, dur: 0.5, vol: 0.17, release: 0.2, arp: { semis: [0, 4, 7, 12], rate: 0.035 } });
  tone(v, { wave: 'triangle', freq: hz('C4'), at: end, dur: 0.5, vol: 0.22, release: 0.2 });
  noise(v, { at: end, dur: 0.4, vol: 0.06, sustain: 0.4, decay: 0.1, release: 0.2, filter: { type: 'highpass', freq: 6500 } });
}

export const JINGLE_SFX: Record<JingleSfx, SfxDef> = {
  countdown: { priority: PRIORITY.important, play: countdown },
  go: { priority: PRIORITY.important, play: go },
  round_win: { priority: PRIORITY.jingle, play: roundWin },
  round_lose: { priority: PRIORITY.jingle, play: roundLose },
  victory: { priority: PRIORITY.jingle, play: victory },
  defeat: { priority: PRIORITY.jingle, play: defeat },
  draw: { priority: PRIORITY.jingle, play: draw },
  match_found: { priority: PRIORITY.jingle, play: matchFound },
  level_up: { priority: PRIORITY.jingle, play: levelUp },
};
