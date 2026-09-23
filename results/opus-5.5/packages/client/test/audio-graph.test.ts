// Drives the real audio facade against a strict fake AudioContext: SFX voice limits and
// teardown, lookahead music scheduling, showdown tempo and crossfades.
// (Autoplay gating and tab visibility live in audio-lifecycle.test.ts.)
import { describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, FakeOscillator } from './audio-fake-context';
import {
  LOOKAHEAD,
  advanceWallClock,
  bus,
  loadAudio,
  run,
  unlocked,
  useFakeAudioEnvironment,
  type SfxName,
} from './audio-harness';

useFakeAudioEnvironment();

/** Start times of bass notes: triangle oscillators with a single fixed pitch. */
function bassStarts(ctx: FakeAudioContext): number[] {
  return ctx.sources
    .filter((s): s is FakeOscillator => s instanceof FakeOscillator && s.type === 'triangle' && s.frequency.events.length === 1)
    .map((s) => s.startTime ?? 0)
    .sort((a, b) => a - b);
}

function gapsOf(starts: number[]): Array<{ at: number; gap: number }> {
  return starts.slice(1).map((t, i) => ({ at: t, gap: t - starts[i] }));
}

/** Battle bass plays every other 16th at 150 bpm. */
const BATTLE_BASS_GAP = 2 * (60 / 150 / 4);

describe('sound effects', () => {
  it('builds every SFX at several levels and pans with valid automation, then tears it down', async () => {
    const { audio } = await loadAudio();
    const { SFX } = await import('../src/audio/sfx');
    const ctx = await unlocked(audio);
    const baseline = new Set(ctx.connectedNodes());
    for (const name of Object.keys(SFX) as SfxName[]) {
      for (const [level, pan] of [[1, 0], [2, -1], [3, 0.6], [5, 1], [9, -0.3], [Number.NaN, Number.NaN]]) {
        advanceWallClock(40);
        expect(() => audio.sfx(name, { level, pan })).not.toThrow();
      }
      expect(bus(ctx, 'sfx').inputs.size).toBeGreaterThan(0);
      run(ctx, 0.3);
    }
    run(ctx, 4);
    expect(new Set(ctx.connectedNodes())).toEqual(baseline);
    expect(bus(ctx, 'sfx').inputs.size).toBe(0);
  });

  it('caps concurrent voices at 12 and lets a jingle steal a lesser voice', async () => {
    const { audio } = await loadAudio();
    const ctx = await unlocked(audio);
    const busy: SfxName[] = ['soak', 'soak_cat', 'tide_alarm', 'burst', 'pickup', 'drop', 'kick', 'reveal', 'tide_step', 'revenge_lob', 'emote_honk', 'emote_quack', 'emote_ribbit', 'emote_squeak'];
    for (const name of busy) audio.sfx(name);
    run(ctx, 0.05); // stolen voices fade out in 25 ms and detach
    expect(bus(ctx, 'sfx').inputs.size).toBe(12);
    const built = ctx.created.length;
    audio.sfx('victory');
    const victoryVoice = ctx.created[built]; // a voice's output gain is its first node
    run(ctx, 0.05);
    expect(bus(ctx, 'sfx').inputs.has(victoryVoice)).toBe(true);
    expect(bus(ctx, 'sfx').inputs.size).toBeLessThanOrEqual(12);
    run(ctx, 6);
    expect(bus(ctx, 'sfx').inputs.size).toBe(0);
  });

  it('rate-limits identical sounds within 30 ms', async () => {
    const { audio } = await loadAudio();
    const ctx = await unlocked(audio);
    audio.sfx('burst');
    advanceWallClock(10);
    audio.sfx('burst');
    expect(bus(ctx, 'sfx').inputs.size).toBe(1);
    advanceWallClock(21);
    audio.sfx('burst');
    expect(bus(ctx, 'sfx').inputs.size).toBe(2);
  });

  it('builds nothing while muted or at zero SFX volume', async () => {
    const { audio } = await loadAudio();
    const ctx = await unlocked(audio);
    audio.applySettings({ sfxVolume: 1, musicVolume: 1, muted: true });
    const before = ctx.created.length;
    audio.sfx('victory');
    audio.applySettings({ sfxVolume: 0, musicVolume: 1, muted: false });
    audio.sfx('burst');
    expect(ctx.created.length).toBe(before);
  });
});

describe('music', () => {
  it('schedules only inside the lookahead window, never in the past', async () => {
    const { audio } = await loadAudio();
    audio.music('battle');
    const ctx = await unlocked(audio);
    for (let i = 0; i < 200; i++) {
      const seen = ctx.sources.length;
      run(ctx, 0.025);
      for (const src of ctx.sources.slice(seen)) {
        expect(src.startTime!).toBeGreaterThanOrEqual(ctx.currentTime - 0.025);
        expect(src.startTime!).toBeLessThanOrEqual(ctx.currentTime + LOOKAHEAD + 1e-9);
      }
    }
  });

  it('showdown glides the battle tempo up ~1.3x starting on a bar line', async () => {
    const { audio } = await loadAudio();
    audio.music('battle');
    const ctx = await unlocked(audio);
    run(ctx, 3);
    const flipAt = ctx.currentTime;
    audio.setShowdown(true);
    run(ctx, 8);
    const gaps = gapsOf(bassStarts(ctx));
    const before = gaps.filter((g) => g.at < flipAt);
    const after = gaps.filter((g) => g.at > ctx.currentTime - 2);
    expect(before.length).toBeGreaterThan(10);
    expect(after.length).toBeGreaterThan(10);
    for (const g of before) expect(g.gap).toBeCloseTo(BATTLE_BASS_GAP, 6);
    for (const g of after) expect(g.gap).toBeCloseTo(BATTLE_BASS_GAP / 1.3, 6);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i].gap).toBeLessThanOrEqual(gaps[i - 1].gap + 1e-9);
      expect(gaps[i - 1].gap - gaps[i].gap).toBeLessThan(0.01);
    }
    // The first faster step sits on a bar line (16 steps = 8 bass notes after the loop start).
    const firstFast = gaps.findIndex((g) => g.gap < BATTLE_BASS_GAP - 1e-6);
    expect(firstFast).toBeGreaterThan(0);
    expect(firstFast % 8).toBe(0);
    expect(gaps[firstFast].at).toBeGreaterThan(flipAt);

    audio.music('results');
    audio.music('battle');
    const restart = ctx.currentTime;
    run(ctx, 2);
    const fresh = bassStarts(ctx).filter((t) => t > restart + 0.5);
    expect(fresh[1] - fresh[0]).toBeCloseTo(BATTLE_BASS_GAP, 6);
  });

  it('turning showdown off mid-glide never makes the tempo jump', async () => {
    const { audio } = await loadAudio();
    audio.music('battle');
    const ctx = await unlocked(audio);
    run(ctx, 2);
    audio.setShowdown(true);
    // Wait until the glide is under way (a bass gap shorter than normal was scheduled)...
    const speedingUp = () => gapsOf(bassStarts(ctx)).some((g) => g.gap < BATTLE_BASS_GAP - 0.005);
    for (let i = 0; i < 200 && !speedingUp(); i++) run(ctx, 0.025);
    expect(speedingUp()).toBe(true);
    run(ctx, 0.3);
    const last = gapsOf(bassStarts(ctx)).at(-1)!;
    expect(last.gap).toBeGreaterThan(BATTLE_BASS_GAP / 1.3 + 0.005); // ...and still mid-glide
    audio.setShowdown(false);
    run(ctx, 8);

    const gaps = gapsOf(bassStarts(ctx));
    for (let i = 1; i < gaps.length; i++) expect(Math.abs(gaps[i].gap - gaps[i - 1].gap)).toBeLessThan(0.01);
    for (const g of gaps.filter((x) => x.at > ctx.currentTime - 2)) expect(g.gap).toBeCloseTo(BATTLE_BASS_GAP, 6);
  });

  it('crossfades tracks, disposes the old one and stops the timer on none', async () => {
    const { audio } = await loadAudio();
    const ctx = await unlocked(audio);
    const baseline = new Set(ctx.connectedNodes());
    audio.music('menu');
    run(ctx, 1);
    audio.music('lobby');
    run(ctx, 0.2);
    expect(bus(ctx, 'music').inputs.size).toBe(2);
    run(ctx, 1);
    expect(bus(ctx, 'music').inputs.size).toBe(1);
    audio.music('none');
    run(ctx, 1);
    expect(bus(ctx, 'music').inputs.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    run(ctx, 3);
    expect(new Set(ctx.connectedNodes())).toEqual(baseline);
  });
});
