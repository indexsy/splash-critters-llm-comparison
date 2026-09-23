// SfxPlayer: turns sfx(name, opts) calls into voices on the SFX bus, enforcing the voice cap
// (12 concurrent), the same-sound rate limit (30 ms) and priority-based voice stealing.
import type { AudioEngine } from './engine';
import { CRITTER_SFX } from './sfx-critters';
import { GAME_SFX } from './sfx-game';
import { JINGLE_SFX } from './sfx-jingles';
import { UI_SFX } from './sfx-ui';
import type { SfxDef, SfxName, SfxOptions } from './types';
import { SfxVoice } from './voice';
import { VoicePool } from './voicePool';

export const SFX: Record<SfxName, SfxDef> = { ...GAME_SFX, ...CRITTER_SFX, ...JINGLE_SFX, ...UI_SFX };

const MAX_VOICES = 12;
const REPEAT_WINDOW_MS = 30;
/** Tiny scheduling offset so the first envelope point is never in the past. */
const START_OFFSET = 0.005;

export class SfxPlayer {
  private readonly pool = new VoicePool<SfxVoice>(MAX_VOICES, REPEAT_WINDOW_MS);

  constructor(private readonly engine: AudioEngine) {}

  play(name: SfxName, opts: SfxOptions = {}): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.sfxBus;
    if (!ctx || !bus || !this.engine.playable || !this.engine.sfxAudible) return;
    const def = SFX[name];
    const nowMs = performance.now();
    const admission = this.pool.request(name, def.priority, nowMs);
    if (!admission.admit) return;
    admission.evict?.steal(ctx.currentTime);

    const voice = new SfxVoice(ctx, bus, finiteOr(opts.pan, 0), (done) => this.pool.release(done));
    this.pool.add(name, def.priority, nowMs, voice);
    try {
      def.play(voice, ctx.currentTime + START_OFFSET, finiteOr(opts.level, 1));
    } finally {
      voice.seal();
    }
  }
}

/** Web Audio throws on non-finite automation values, so sanitize caller-provided numbers. */
function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
