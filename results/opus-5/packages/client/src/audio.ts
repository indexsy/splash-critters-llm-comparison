/**
 * The game's audio surface. Everything is synthesised with Web Audio
 * oscillators and noise buffers: there are no sample files anywhere.
 *
 * Implementation lives in audio/: context.ts (the gain tree and synth voices),
 * sfx.ts (one-shots, chain jingles, animal calls) and music.ts (the scheduled
 * chiptune loops). This module is the only thing screens should import.
 */

import { applyVolumes, initAudio as unlockContext, toggleMute } from './audio/context';
import { flushPendingMusic } from './audio/music';

export type { SfxName, AnimalVoice } from './audio/sfx';
export type { MusicTrack } from './audio/music';

export { playSfx, playChain, playEmote } from './audio/sfx';
export { startMusic, stopMusic, setMusicSpeed } from './audio/music';
export { applyVolumes, toggleMute };

/**
 * Unlocks audio. Must be called from inside a user gesture; safe to call as
 * often as you like, and it picks up any track requested before the first
 * gesture landed.
 */
export function initAudio(): void {
  unlockContext();
  applyVolumes();
  flushPendingMusic();
}
