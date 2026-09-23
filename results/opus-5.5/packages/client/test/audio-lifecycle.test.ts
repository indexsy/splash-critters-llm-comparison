// AudioContext lifecycle against a fake whose resume()/suspend() land asynchronously, as in
// real browsers: autoplay gating, the first gesture's sound, tab visibility pauses, and quick
// hide/show toggles that race an in-flight resume or suspend.
import { describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, FakeGain, FakeOscillator } from './audio-fake-context';
import {
  FakeDocument,
  LOOKAHEAD,
  advanceWallClock,
  bus,
  loadAudio,
  run,
  settle,
  unlocked,
  useFakeAudioEnvironment,
} from './audio-harness';

useFakeAudioEnvironment();

function startsAfter(ctx: FakeAudioContext, from: number): number[] {
  return ctx.sources.map((s) => s.startTime ?? 0).filter((t) => t > from);
}

function oscillators(ctx: FakeAudioContext): FakeOscillator[] {
  return ctx.sources.filter((s): s is FakeOscillator => s instanceof FakeOscillator);
}

/** A visible page with `track` playing for a second. */
async function playingWithDocument(track: 'menu' | 'lobby') {
  const doc = new FakeDocument();
  vi.stubGlobal('document', doc);
  const { audio } = await loadAudio();
  audio.music(track);
  const ctx = await unlocked(audio);
  run(ctx, 1);
  return { doc, audio, ctx };
}

describe('autoplay gating', () => {
  it('is inert before unlock and starts the remembered track afterwards', async () => {
    const { audio } = await loadAudio();
    audio.applySettings({ sfxVolume: 0.5, musicVolume: 1, muted: false });
    audio.sfx('burst');
    audio.music('title');
    audio.setShowdown(true);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(audio.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const ctx = await unlocked(audio);
    audio.unlock();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(audio.ready).toBe(true);
    const sfxGain = (bus(ctx, 'sfx') as FakeGain).gain.events[0].value;
    expect(sfxGain).toBeCloseTo(0.25 * 0.9, 9);
    run(ctx, 1);
    expect(oscillators(ctx).length).toBeGreaterThan(5);
  });

  it('plays the sound triggered by the same gesture that unlocks audio', async () => {
    const { audio } = await loadAudio();
    // main.ts: capture-phase pointerdown -> unlock(); then the button handler plays ui_select.
    audio.unlock();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.state).toBe('suspended'); // the resume has not landed yet
    const primingOnly = ctx.sources.length;
    audio.sfx('ui_select');
    expect(ctx.sources.length).toBeGreaterThan(primingOnly);
    const uiStarts = ctx.sources.slice(primingOnly).map((s) => s.startTime!);

    await settle(ctx);
    expect(audio.ready).toBe(true);
    run(ctx, 1);
    // Scheduled on the frozen clock, so it sounds the moment the clock starts, then tears down.
    expect(Math.min(...uiStarts)).toBeLessThan(0.02);
    expect(bus(ctx, 'sfx').inputs.size).toBe(0);
  });

  it('stops building sounds for a resume that seems blocked', async () => {
    const { audio } = await loadAudio();
    audio.unlock();
    const ctx = FakeAudioContext.instances[0];
    advanceWallClock(400); // the resume is still in flight long after the gesture
    const before = ctx.sources.length;
    audio.sfx('burst');
    expect(ctx.sources.length).toBe(before);
  });
});

describe('tab visibility', () => {
  it('pauses while the tab is hidden and resumes without stale notes', async () => {
    const { doc, audio, ctx } = await playingWithDocument('lobby');

    doc.setHidden(true);
    expect(audio.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await settle(ctx);
    expect(ctx.state).toBe('suspended');
    const frozenAt = ctx.currentTime;
    const count = ctx.sources.length;
    run(ctx, 5);
    expect(ctx.sources.length).toBe(count);
    audio.sfx('burst');
    expect(ctx.sources.length).toBe(count);

    doc.setHidden(false);
    await settle(ctx);
    expect(ctx.state).toBe('running');
    expect(audio.ready).toBe(true);
    run(ctx, 1);
    const resumed = startsAfter(ctx, frozenAt + LOOKAHEAD);
    expect(resumed.length).toBeGreaterThan(5);

    // A second gesture while visible is harmless.
    audio.unlock();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(ctx.pendingControl).toBe(0);

    // A throttled timer while the clock kept running must not dump missed notes in the past.
    ctx.advance(2);
    const before = ctx.sources.length;
    run(ctx, 0.025);
    for (const src of ctx.sources.slice(before)) expect(src.startTime!).toBeGreaterThanOrEqual(ctx.currentTime - 0.025);
  });

  it('stays silent when unlocked while hidden and starts once the page is visible', async () => {
    const doc = new FakeDocument();
    doc.visibilityState = 'hidden';
    vi.stubGlobal('document', doc);
    const { audio } = await loadAudio();
    audio.music('menu');
    audio.unlock();
    const ctx = FakeAudioContext.instances[0];
    await settle(ctx);
    expect(ctx.state).toBe('suspended');
    expect(audio.ready).toBe(false);
    run(ctx, 1);
    expect(oscillators(ctx)).toHaveLength(0);

    doc.setHidden(false);
    await settle(ctx);
    expect(audio.ready).toBe(true);
    run(ctx, 1);
    expect(oscillators(ctx).length).toBeGreaterThan(5);
  });

  it('recovers when the page is shown again before the suspend has landed', async () => {
    const { doc, audio, ctx } = await playingWithDocument('menu');
    doc.setHidden(true);
    expect(ctx.state).toBe('running'); // suspend requested, not landed
    doc.setHidden(false);
    await settle(ctx);

    expect(ctx.state).toBe('running');
    expect(audio.ready).toBe(true);
    const from = ctx.currentTime;
    run(ctx, 1);
    expect(startsAfter(ctx, from).length).toBeGreaterThan(5);
  });

  it('ends suspended when the page is hidden again before the resume has landed', async () => {
    const { doc, audio, ctx } = await playingWithDocument('menu');
    doc.setHidden(true);
    await settle(ctx);
    doc.setHidden(false);
    expect(ctx.state).toBe('suspended'); // resume requested, not landed
    doc.setHidden(true);
    await settle(ctx);

    expect(ctx.state).toBe('suspended');
    expect(audio.ready).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-steers when a synchronous suspend is overtaken by a slower resume (Chrome timing)', async () => {
    FakeAudioContext.immediateSuspend = true;
    const { doc, audio, ctx } = await playingWithDocument('menu');
    doc.setHidden(true);
    expect(ctx.state).toBe('suspended');
    doc.setHidden(false); // resume in flight
    doc.setHidden(true); // suspend is a no-op now; the resume lands afterwards
    await settle(ctx);

    expect(ctx.state).toBe('suspended');
    expect(audio.ready).toBe(false);

    doc.setHidden(false);
    await settle(ctx);
    expect(ctx.state).toBe('running');
    expect(audio.ready).toBe(true);
  });
});
