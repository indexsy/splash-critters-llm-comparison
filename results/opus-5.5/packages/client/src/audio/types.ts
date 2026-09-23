// Public audio vocabulary shared by the facade (../audio.ts) and the audio internals.
import type { Sink } from './synth';

export type SfxName =
  | 'drop'
  | 'burst'
  | 'chain'
  | 'pickup'
  | 'reveal'
  | 'soak'
  | 'soak_cat'
  | 'kick'
  | 'tide_alarm'
  | 'tide_step'
  | 'countdown'
  | 'go'
  | 'round_win'
  | 'round_lose'
  | 'victory'
  | 'defeat'
  | 'draw'
  | 'revenge_lob'
  | 'emote_quack'
  | 'emote_ribbit'
  | 'emote_squeak'
  | 'emote_honk'
  | 'ui_move'
  | 'ui_select'
  | 'ui_back'
  | 'match_found'
  | 'level_up'
  | 'xp_tick'
  | 'error';

export type MusicTrack = 'none' | 'title' | 'menu' | 'lobby' | 'battle' | 'results' | 'tutorial';

/** Every track that has a song attached. */
export type SongTrack = Exclude<MusicTrack, 'none'>;

export interface SfxOptions {
  /**
   * Intensity knob, default 1. `chain`: cascade size (2 = DOUBLE, 3 = TRIPLE, 4+ bigger).
   * `burst`: balloon range (bigger splash, slightly longer). `xp_tick`: tick index (pitch
   * rises a semitone per tick, capped at an octave). Other sounds ignore it.
   */
  level?: number;
  /** Stereo position -1 (left) .. 1 (right), e.g. from the event's arena x. */
  pan?: number;
}

export interface AudioSettings {
  /** 0..1 linear slider value (clamped); mapped through a perceptual curve. */
  sfxVolume: number;
  /** 0..1 linear slider value (clamped); mapped through a perceptual curve. */
  musicVolume: number;
  /** Silences both buses. */
  muted: boolean;
}

/**
 * Voice-stealing priority. When all SFX voices are busy, a new sound may only replace the
 * oldest playing sound of equal or lower priority; otherwise it is dropped.
 */
export const PRIORITY = { ambient: 0, action: 1, important: 2, jingle: 3 } as const;
export type SfxPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

export interface SfxDef {
  priority: SfxPriority;
  /** Build the sound into `v`, starting at context time `at`. */
  play(v: Sink, at: number, level: number): void;
}
