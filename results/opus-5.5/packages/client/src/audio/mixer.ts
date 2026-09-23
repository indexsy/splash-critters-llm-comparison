// Output graph: sfx bus + music bus -> master -> glue compressor -> limiter -> speakers.
// Bus gains follow the player's settings; mute silences the master.
import type { AudioSettings } from './types';

export interface Mixer {
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
}

/**
 * Headroom per bus so a full-volume slider still leaves room for stacked sounds. Tracks
 * render at roughly 0.12-0.17 RMS with transient peaks up to ~1.1 (measured offline), so
 * music sits ~10 dB under the SFX while its peaks stay below the limiter at full volume.
 */
const SFX_HEADROOM = 0.9;
const MUSIC_HEADROOM = 0.7;
/** Smoothing time constant for volume changes (no zipper noise when dragging sliders). */
const LEVEL_SMOOTHING = 0.03;

/** Map a 0..1 slider to gain with a perceptual (squared) curve; clamps bad input. */
export function volumeToGain(volume: number): number {
  const v = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  return v * v;
}

export function busLevels(settings: AudioSettings): { master: number; sfx: number; music: number } {
  return {
    master: settings.muted ? 0 : 1,
    sfx: volumeToGain(settings.sfxVolume) * SFX_HEADROOM,
    music: volumeToGain(settings.musicVolume) * MUSIC_HEADROOM,
  };
}

export function createMixer(ctx: AudioContext): Mixer {
  const master = ctx.createGain();
  const sfx = ctx.createGain();
  const music = ctx.createGain();

  // Gentle glue compression for the whole mix...
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.knee.value = 8;
  glue.ratio.value = 4;
  glue.attack.value = 0.004;
  glue.release.value = 0.18;

  // ...then a fast, hard limiter so a dozen overlapping bursts never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;

  sfx.connect(master);
  music.connect(master);
  master.connect(glue);
  glue.connect(limiter);
  limiter.connect(ctx.destination);
  return { master, sfx, music };
}

/** Move the bus gains to match `settings` (smoothed, or instantly when `immediate`). */
export function setMixLevels(mixer: Mixer, settings: AudioSettings, now: number, immediate = false): void {
  const levels = busLevels(settings);
  const pairs: Array<[AudioParam, number]> = [
    [mixer.master.gain, levels.master],
    [mixer.sfx.gain, levels.sfx],
    [mixer.music.gain, levels.music],
  ];
  for (const [param, value] of pairs) {
    param.cancelScheduledValues(now);
    if (immediate) param.setValueAtTime(value, now);
    else param.setTargetAtTime(value, now, LEVEL_SMOOTHING);
  }
}
