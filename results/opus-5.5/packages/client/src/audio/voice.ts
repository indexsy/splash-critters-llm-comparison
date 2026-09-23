// One playing sound effect: a private output gain (plus optional stereo panner) that the
// recipe's node chains feed into. It counts its sources, tears itself down once all of them
// have ended, and can be stolen (fast fade + stop) when the voice pool is full.
import type { Sink } from './synth';

/** Fade applied when a voice is stolen, short enough to be inaudible as a click. */
const STEAL_FADE = 0.025;
/** Safety net: finish a stolen voice even if some never-started source never fires 'ended'. */
const STEAL_FORCE_FINISH_MS = 300;

export class SfxVoice implements Sink {
  readonly out: GainNode;
  private readonly panner: StereoPannerNode | null;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private live = 0;
  private sealed = false;
  private done = false;

  constructor(
    readonly ctx: BaseAudioContext,
    destination: AudioNode,
    pan: number,
    private readonly onDone: (voice: SfxVoice) => void,
  ) {
    this.out = ctx.createGain();
    const clamped = Math.max(-1, Math.min(1, pan));
    if (clamped !== 0 && typeof ctx.createStereoPanner === 'function') {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = clamped;
      this.out.connect(this.panner);
      this.panner.connect(destination);
    } else {
      this.panner = null;
      this.out.connect(destination);
    }
  }

  track(src: AudioScheduledSourceNode): void {
    this.live++;
    this.sources.push(src);
    src.addEventListener(
      'ended',
      () => {
        this.live--;
        this.finishIfIdle();
      },
      { once: true },
    );
  }

  /** The recipe has added all of its sources; a voice with none finishes immediately. */
  seal(): void {
    this.sealed = true;
    this.finishIfIdle();
  }

  /** Silence quickly (voice stealing). The voice finishes when its sources end. */
  steal(now: number): void {
    if (this.done) return;
    const gain = this.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + STEAL_FADE);
    for (const src of this.sources) {
      try {
        src.stop(now + STEAL_FADE);
      } catch {
        // Already stopped or never started: nothing left to silence.
      }
    }
    setTimeout(() => this.finish(), STEAL_FORCE_FINISH_MS);
  }

  private finishIfIdle(): void {
    if (this.sealed && this.live <= 0) this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.out.disconnect();
    this.panner?.disconnect();
    this.sources.length = 0;
    this.onDone(this);
  }
}
