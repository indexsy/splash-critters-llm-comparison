// TrackPlayer: plays one compiled song in a loop on the AudioContext clock.
// The owner calls schedule(now, horizon) every few tens of ms; the player emits every step
// whose start time falls before the horizon (lookahead scheduling), so timing is sample-
// accurate even though the JS timer that drives it is jittery.
import { playDrum, playNote } from './instruments';
import {
  planTempoChange,
  rampScaleAt,
  stepSeconds,
  steadyTempo,
  type TempoRamp,
} from './notes';
import type { CompiledSong } from './song';
import type { Sink } from './synth';

/** Fraction of each note's length that sounds (a slight gap keeps chip lines articulate). */
const GATE = 0.9;
const MIN_NOTE = 0.03;
/** When the clock ran past our next step (throttled timer, resumed context) restart here. */
const RESYNC_DELAY = 0.03;
/** After a fade-out finishes, keep the output a little longer for note tails. */
const DISPOSE_TAIL = 0.15;

export class TrackPlayer implements Sink {
  readonly out: GainNode;
  /** Next step to schedule (monotonic; wraps into the song with `% steps`). */
  private step = 0;
  private nextTime: number;
  private ramp: TempoRamp;
  private stopAt = Infinity;

  constructor(
    readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly song: CompiledSong,
    startTime: number,
    tempoScale: number,
  ) {
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.nextTime = startTime;
    this.ramp = steadyTempo(tempoScale);
  }

  /** Change tempo (e.g. showdown): glides to `scale` over one bar starting at the next bar line. */
  setTempoScale(scale: number): void {
    this.ramp = planTempoChange(this.ramp, this.step, scale, this.song.barSteps);
  }

  fadeIn(now: number, seconds: number): void {
    const gain = this.out.gain;
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(1, now + seconds);
  }

  /** Fade to silence and stop scheduling new steps once the fade completes. */
  fadeOut(now: number, seconds: number): void {
    const gain = this.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + seconds);
    this.stopAt = Math.min(this.stopAt, now + seconds);
  }

  /** True once a faded-out player can be disposed. */
  isFinished(now: number): boolean {
    return now >= this.stopAt + DISPOSE_TAIL;
  }

  dispose(): void {
    this.out.disconnect();
  }

  schedule(now: number, horizon: number): void {
    if (this.nextTime < now) this.nextTime = now + RESYNC_DELAY;
    while (this.nextTime < horizon && this.nextTime < this.stopAt) {
      const dur = stepSeconds(this.song.bpm, rampScaleAt(this.ramp, this.step));
      this.playStep(this.step % this.song.steps, this.nextTime, dur);
      this.nextTime += dur;
      this.step++;
    }
  }

  private playStep(step: number, time: number, stepDur: number): void {
    const at = step % 2 === 1 ? time + this.song.swing * stepDur : time;
    for (const ch of this.song.channels) {
      const local = step % ch.steps;
      if (ch.kind === 'pitched') {
        const ev = ch.at[local];
        if (ev) playNote(this, ch.inst, ev.midi, ev.arp, at, Math.max(MIN_NOTE, ev.len * stepDur * GATE), ch.vol);
      } else {
        const hits = ch.at[local];
        if (hits) for (const hit of hits) playDrum(this, hit, at, ch.vol);
      }
    }
  }
}
