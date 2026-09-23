// Game audio facade: Web Audio SFX + looping chiptunes, synthesized at runtime (no files).
//
//   audio.unlock()                 on every user gesture until ready (autoplay policy)
//   audio.applySettings(settings)  whenever volumes / mute change
//   audio.sfx('burst', { pan })    fire-and-forget sound effects
//   audio.music('battle')          switch the looping track (crossfade); 'none' stops
//   audio.setShowdown(true)        battle loop speeds up (~1.3x) from the next bar
//
// Before unlock() everything is a silent no-op; a music() request made earlier is
// remembered and starts as soon as audio unlocks. Scheduling pauses while the tab is hidden.
import { AudioEngine } from './audio/engine';
import { MusicDirector } from './audio/music';
import { SfxPlayer } from './audio/sfx';
import type { AudioSettings, MusicTrack, SfxName, SfxOptions } from './audio/types';

export type { AudioSettings, MusicTrack, SfxName, SfxOptions } from './audio/types';

export interface GameAudio {
  /** Create/resume the AudioContext. Call from user gestures; safe to call repeatedly. */
  unlock(): void;
  applySettings(settings: AudioSettings): void;
  sfx(name: SfxName, opts?: SfxOptions): void;
  /** Crossfade to a looping track; 'none' fades out. Switching tracks clears showdown. */
  music(track: MusicTrack): void;
  /** Showdown tempo for the battle loop (2 players left). Turn off again at round start. */
  setShowdown(on: boolean): void;
  /** True while the AudioContext is running and the page is visible (unlocked, not suspended). */
  readonly ready: boolean;
}

const engine = new AudioEngine(refreshMusicActivity);
const sfxPlayer = new SfxPlayer(engine);
const director = new MusicDirector(engine);
let visibilityHooked = false;

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Music may schedule only while the context runs and the page is visible. */
function refreshMusicActivity(): void {
  director.setActive(engine.running);
}

function hookVisibility(): void {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    engine.setPageHidden(pageHidden());
    refreshMusicActivity();
  });
}

export const audio: GameAudio = {
  unlock() {
    hookVisibility();
    engine.setPageHidden(pageHidden());
    engine.unlock();
    refreshMusicActivity();
  },
  applySettings(settings) {
    engine.applySettings(settings);
  },
  sfx(name, opts) {
    sfxPlayer.play(name, opts);
  },
  music(track) {
    director.play(track);
  },
  setShowdown(on) {
    director.setShowdown(on);
  },
  get ready() {
    return engine.running;
  },
};
