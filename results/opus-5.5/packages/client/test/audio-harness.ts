// Shared setup for tests that drive the real audio facade against FakeAudioContext: a fresh
// module per test, fake JS timers + performance.now, and helpers that advance the audio
// clock, the timers and the wall clock together.
import { afterEach, beforeEach, vi } from 'vitest';
import { FakeAudioContext, FakeGain, type FakeNode } from './audio-fake-context';

export type AudioModule = typeof import('../src/audio');
export type GameAudio = AudioModule['audio'];
export type SfxName = import('../src/audio').SfxName;

/** Must match the scheduler lookahead in src/audio/music.ts. */
export const LOOKAHEAD = 0.1;

export class FakeDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  private readonly listeners: Array<() => void> = [];
  addEventListener(type: string, cb: () => void): void {
    if (type === 'visibilitychange') this.listeners.push(cb);
  }
  setHidden(hidden: boolean): void {
    this.visibilityState = hidden ? 'hidden' : 'visible';
    for (const cb of this.listeners) cb();
  }
}

let clockMs = 0;

/** Register the per-test fake environment (call once at the top of a test file). */
export function useFakeAudioEnvironment(): void {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.immediateSuspend = false;
    clockMs = 1000;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

/** Move performance.now() forward without touching the audio clock or timers. */
export function advanceWallClock(ms: number): void {
  clockMs += ms;
}

/** Import a fresh copy of the facade (module state is per test). */
export async function loadAudio(): Promise<AudioModule> {
  vi.resetModules();
  return import('../src/audio');
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Let every queued resume()/suspend() land, including ones issued while landing. */
export async function settle(ctx: FakeAudioContext): Promise<void> {
  do await nextTask();
  while (ctx.pendingControl > 0);
}

/** unlock() from a gesture, let the context start and the priming buffer finish. */
export async function unlocked(audio: GameAudio): Promise<FakeAudioContext> {
  audio.unlock();
  const ctx = FakeAudioContext.instances[0];
  await settle(ctx);
  run(ctx, 0.05);
  return ctx;
}

/** Advance audio clock, JS timers and performance.now together in 25 ms slices. */
export function run(ctx: FakeAudioContext, seconds: number): void {
  const slices = Math.round(seconds / 0.025);
  for (let i = 0; i < slices; i++) {
    clockMs += 25;
    ctx.advance(0.025);
    vi.advanceTimersByTime(25);
  }
}

/** Mixer buses are the first three gains created: master, sfx, music. */
export function bus(ctx: FakeAudioContext, which: 'sfx' | 'music'): FakeNode {
  const gains = ctx.created.filter((n) => n instanceof FakeGain);
  return gains[which === 'sfx' ? 1 : 2];
}
