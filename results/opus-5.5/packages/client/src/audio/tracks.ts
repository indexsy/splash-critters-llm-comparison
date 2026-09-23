// The soundtrack: one looping chiptune per screen, written as compact note strings
// (grammar in notes.ts). Each bar is 16 sixteenth-note steps; shorter channels loop
// inside the longest one. Riff helpers stamp chord roots into rhythm templates.
import type { SongDef } from './song';
import type { SongTrack } from './types';

/** Fill "$1", "$2"... placeholders: riff('$1 . $2 .')('C3', 'G2') === 'C3 . G2 .'. */
function riff(template: string): (...notes: string[]) => string {
  return (...notes) =>
    template.replace(/\$(\d)/g, (_match, index: string) => {
      const note = notes[Number(index) - 1];
      if (note === undefined) throw new Error(`riff placeholder $${index} has no note`);
      return note;
    });
}

const bars = (...parts: string[]): string => parts.join(' | ');

// ---- rhythm templates -----------------------------------------------------------------
const bounce = riff('$1 . . $1 . . $2 . $1 . . $1 . . $2 .');
const stabs = riff('. . $1 - . . $1 - . . $1 - . . $1 -');
const offbeat = riff('. . $1 . . . $1 . . . $1 . . . $1 .');
const pump = riff('$1 . $2 . $1 . $2 . $1 . $2 . $1 . $2 .');
const walk = riff('$1 - - - . . $2 . $1 - - - $3 - - .');
const groove = riff('$1 - - . $1 . . $2 - . $3 . $1 - . .');
const pad = riff('$1 -*5 . . $1 - - . $1 - . .');
const quarters = riff('$1 - - . $1 - - . $1 - - . $1 - - .');
const halves = riff('$1 -*6 . $2 -*6 .');
const steps = riff('$1 - . . $2 - . . $1 - . . $2 - . .');

// ---- title: bright C major anthem --------------------------------------------------------
const TITLE_LEAD = bars(
  'G4 . C5 . E5 . G5 - - . E5 . G5 - C6 .',
  'B5 - A5 - - . E5 . A5 - - . C6 - B5 .',
  'A5 - - . F5 . A5 . C6 - - . A5 . F5 .',
  'G5 - - - - . D5 . G5 . B5 . D6 - - .',
  'E6 - - . D6 . C6 . G5 - - . E5 . G5 .',
  'A5 - - . G5 . E5 . C5 - - . E5 . A5 .',
  'F5 - A5 - C6 - F6 - E6 - D6 - C6 - A5 -',
  'B5 - - - D6 - - - G5 - - - - - . .',
);
const TITLE_BEAT = 'k . h . s . h . k . k h s . h .';
const TITLE_FILL = 'k . h . s . h . k . s . s s o .';

// ---- menu: relaxed G major stroll with an echo voice -------------------------------------
const MENU_LEAD = bars(
  'D5 - - . B4 . D5 . G5 - - - F#5 - E5 -',
  'D5 - - - B4 - - . G4 . B4 . E5 - - .',
  'E5 - - . G5 . E5 . C5 - - - D5 - E5 -',
  'F#5 - - - A5 - - - D5 - - - - - - .',
  'B5 - - . A5 . G5 . D5 - - . G5 . B5 .',
  'A5 - G5 - E5 - - . B4 . E5 . G5 - - .',
  'G5 - - . E5 . C5 . E5 . G5 . C6 - B5 -',
  'A5 - - - F#5 - - - D5 - E5 - F#5 - A5 -',
);
const MENU_BEAT = 'k . h . . . h . s . h . . . h h';
const MENU_FILL = 'k . h . . . h . s . h . s s h h';

// ---- lobby: swung, jazzy waiting-room loop over arpeggiated 7th chords -------------------
const LOBBY_LEAD = bars(
  '. . F5 . A5 . C6 - - . A5 . . . . .',
  '. . F5 . G5 . B5 - - . A5 . G5 - - .',
  '. . E5 . G5 . B5 - - . C6 - - - B5 .',
  'A5 - - - G5 - E5 - C5 - - - - - . .',
  '. . D6 . C6 . A5 - - . F5 . . . . .',
  '. . G5 . F5 . D5 - - . B4 . D5 - - .',
  '. . C6 . B5 . G5 - - . E5 - G5 - B5 .',
  'A5 - - - - - - - . . . . . . . .',
);

// ---- battle: driving A minor, octave-pumping bass (sped up in showdown) ------------------
const BATTLE_LEAD = bars(
  'A4 . C5 . E5 - A5 . G5 - E5 . C5 - D5 .',
  'C5 - - A4 . C5 . F5 - - E5 . C5 . A4 .',
  'B4 - D5 . G5 - D5 . B4 . D5 . G5 - A5 .',
  'G#5 - - - E5 - B4 - G#4 - B4 - E5 - - .',
  'E5 - A5 - C6 - B5 A5 G5 - E5 - A5 - - .',
  'F5 - A5 - C6 - A5 - G5 F5 E5 - F5 - - .',
  'G5 - D5 - B4 - D5 - G5 - A5 - B5 - D6 .',
  'E6 - - - D6 C6 B5 - G#5 - - - E5 . G#5 .',
);
const BATTLE_BEAT = 'kh . h . sh . h k kh . h . sh . h h';
const BATTLE_CRASH = 'kc . h . sh . h k kh . h . sh . h h';
const BATTLE_FILL = 'kh . h . sh . h k kh . s . s s s s';

// ---- results: warm F major victory lap ---------------------------------------------------
const RESULTS_LEAD = bars(
  'C5 - F5 - A5 - - - G5 - F5 - C5 - - -',
  'E5 - G5 - C6 - - - Bb5 - A5 - G5 - - -',
  'D5 - F5 - Bb5 - - - A5 - G5 - F5 - D5 -',
  'E5 - - - G5 - - - C6 - - - - - . .',
  'A5 - - - C6 - A5 - F5 - - - A5 - C6 -',
  'G5 - - - E5 - C5 - G5 - - - Bb5 - - -',
  'A5 - - - F5 - D5 - Bb5 - A5 - G5 - F5 -',
  'E5 - - - G5 - - - F5 - - - - - . .',
);

// ---- tutorial: gentle, curious G major with an echo voice --------------------------------
const TUTORIAL_LEAD = bars(
  'G4 - B4 - D5 - - . B4 - D5 - G5 - - .',
  'E5 - - . C5 - E5 - G5 - - . E5 - - .',
  'F#5 - - . D5 - A4 - D5 - F#5 - A5 - - .',
  'G5 - - - - - . . D5 - - - . . . .',
  'B4 - D5 - G5 - - . A5 - G5 - D5 - - .',
  'E5 - G5 - B5 - - . A5 - G5 - E5 - - .',
  'C5 - E5 - A5 - - . G5 - E5 - C5 - - .',
  'D5 - - - F#5 - - - A5 - - - F#5 - - .',
);

export const SONGS: Record<SongTrack, SongDef> = {
  title: {
    bpm: 132,
    channels: [
      { inst: 'pulse25', vol: 0.16, notes: TITLE_LEAD },
      { inst: 'pulse12', vol: 0.07, notes: bars(stabs('C4+47'), stabs('A3+37'), stabs('F3+47'), stabs('G3+47')) },
      { inst: 'triangle', vol: 0.3, notes: bars(bounce('C3', 'G2'), bounce('A2', 'E2'), bounce('F2', 'C3'), bounce('G2', 'D3')) },
      { inst: 'drums', vol: 0.42, hits: bars(TITLE_BEAT, TITLE_BEAT, TITLE_BEAT, TITLE_FILL) },
    ],
  },
  menu: {
    bpm: 112,
    channels: [
      { inst: 'pulse25', vol: 0.14, notes: MENU_LEAD },
      { inst: 'pulse12', vol: 0.05, notes: MENU_LEAD, shift: 3 },
      { inst: 'triangle', vol: 0.32, notes: bars(walk('G2', 'D3', 'B2'), walk('E2', 'B2', 'G2'), walk('C3', 'G2', 'E3'), walk('D3', 'A2', 'F#3')) },
      { inst: 'drums', vol: 0.4, hits: bars(MENU_BEAT, MENU_BEAT, MENU_BEAT, MENU_FILL) },
    ],
  },
  lobby: {
    bpm: 120,
    swing: 0.18,
    channels: [
      { inst: 'pulse25', vol: 0.13, notes: LOBBY_LEAD },
      { inst: 'pulse12', vol: 0.07, notes: bars(pad('D4+37a'), pad('G3+47a'), pad('C4+47b'), pad('A3+37a')) },
      { inst: 'triangle', vol: 0.32, notes: bars(groove('D3', 'A2', 'C3'), groove('G2', 'D2', 'F2'), groove('C3', 'G2', 'B2'), groove('A2', 'E2', 'G2')) },
      { inst: 'drums', vol: 0.4, hits: 'k . h . s . h k . k h . s . h .' },
    ],
  },
  battle: {
    bpm: 150,
    showdownScale: 1.3,
    channels: [
      { inst: 'pulse25', vol: 0.15, notes: BATTLE_LEAD },
      { inst: 'pulse12', vol: 0.06, notes: bars(offbeat('A4+37'), offbeat('F4+47'), offbeat('G4+47'), offbeat('E4+47')) },
      { inst: 'triangle', vol: 0.28, notes: bars(pump('A2', 'A3'), pump('F2', 'F3'), pump('G2', 'G3'), pump('E2', 'E3')) },
      {
        inst: 'drums',
        vol: 0.4,
        hits: bars(BATTLE_CRASH, BATTLE_BEAT, BATTLE_BEAT, BATTLE_FILL, BATTLE_BEAT, BATTLE_BEAT, BATTLE_BEAT, BATTLE_FILL),
      },
    ],
  },
  results: {
    bpm: 104,
    channels: [
      { inst: 'pulse25', vol: 0.14, notes: RESULTS_LEAD },
      { inst: 'pulse12', vol: 0.06, notes: bars(quarters('F4+47'), quarters('C4+47'), quarters('Bb3+47'), quarters('C4+47')) },
      { inst: 'triangle', vol: 0.3, notes: bars(halves('F2', 'C3'), halves('C3', 'G2'), halves('Bb2', 'F2'), halves('C3', 'G2')) },
      { inst: 'drums', vol: 0.38, hits: 'k . h . s . h . k . h . s . h h' },
    ],
  },
  tutorial: {
    bpm: 100,
    channels: [
      { inst: 'pulse25', vol: 0.13, notes: TUTORIAL_LEAD },
      { inst: 'pulse12', vol: 0.045, notes: TUTORIAL_LEAD, shift: 3 },
      {
        inst: 'triangle',
        vol: 0.28,
        notes: bars(
          steps('G2', 'D3'),
          steps('C3', 'G2'),
          steps('D3', 'A2'),
          steps('G2', 'D3'),
          steps('G2', 'D3'),
          steps('E2', 'B2'),
          steps('A2', 'E3'),
          steps('D3', 'A2'),
        ),
      },
      { inst: 'drums', vol: 0.3, hits: 'k . . . h . h . s . . . h . . .' },
    ],
  },
};
