// The round's go-live boundary: the client must not predict or send inputs before the server
// takes them. The server simulates tick 1 on its 30 Hz grid one period after startTime (tick 0)
// and rejects inputs until then (MatchRunner: 'countdown' -> 'live' on that tick, pushInput is
// false outside 'live'). A client that went live at startTime ("SPLASH!") lost its first input on
// fast links, and with it a balloon pressed at SPLASH!: the ghost and drop sound played, then
// the ghost vanished. Driven through the real MatchState and InputPacer frame by frame.
import { CONFIG, Dir } from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { roundLiveAt } from '../src/game/clock';
import { InputPacer } from '../src/game/inputPacer';
import { START, duelConfig, matchInRound, roundStartFor } from './match-fixtures';

/** input.ts's latches: a direction edge and a balloon edge, dropped together. */
class FakeLatches {
  dirPress = false;
  balloon = false;
  consumeDirPress(): boolean {
    const v = this.dirPress;
    this.dirPress = false;
    return v;
  }
  consumeBalloon(): boolean {
    const v = this.balloon;
    this.balloon = false;
    return v;
  }
  clearLatches(): void {
    this.dirPress = false;
    this.balloon = false;
  }
}

interface Trial {
  fps: number;
  /** Offset (0..1 of a frame) of the client's frames against the server grid. */
  phase: number;
  /** One-way latency client -> server (ms). */
  oneWayMs: number;
  /** How late the server's ticker fires after the grid time it stands for (ms). */
  timerLateMs: number;
  /** When (relative to startTime) the balloon key goes down, if at all. */
  balloonAt?: number;
  /** When (relative to startTime) a direction key goes down, if at all. */
  dirPressAt?: number;
}

interface Sent {
  seq: number;
  sentAt: number;
  balloon: boolean;
  accepted: boolean;
}

/** Runs frames through the round start; the server accepts what arrives after its first tick. */
function run(t: Trial): Sent[] {
  const m = matchInRound(duelConfig(), roundStartFor(duelConfig()));
  const latches = new FakeLatches();
  const pacer = new InputPacer(latches);
  const serverLiveAt = START + CONFIG.TICK_MS + t.timerLateMs;
  const frameMs = 1000 / t.fps;
  const sent: Sent[] = [];
  let prev = START - 400 + t.phase * frameMs;
  for (let now = prev + frameMs; now < START + 300; prev = now, now += frameMs) {
    if (t.balloonAt !== undefined && START + t.balloonAt > prev && START + t.balloonAt <= now) latches.balloon = true;
    if (t.dirPressAt !== undefined && START + t.dirPressAt > prev && START + t.dirPressAt <= now) latches.dirPress = true;
    const steps = pacer.ticksDue(m.inputGate(now), now - prev);
    for (let i = 0; i < steps; i++) {
      const balloon = latches.consumeBalloon();
      const msg = m.localTick(Dir.Right, balloon, now);
      if (!msg) break;
      sent.push({ seq: msg.seq, sentAt: now, balloon: msg.balloonPressed, accepted: now + t.oneWayMs >= serverLiveAt });
    }
  }
  return sent;
}

const FPS = [60, 120, 144];
const PHASES = [0, 0.13, 0.29, 0.5, 0.71, 0.97];

describe('round go-live', () => {
  it('never sends an input the server rejects, on any link, frame rate or frame phase', () => {
    for (const fps of FPS) {
      for (const phase of PHASES) {
        for (const oneWayMs of [0, 1, 5, 10, 20, 40]) {
          for (const timerLateMs of [0, 1, 3]) {
            const sent = run({ fps, phase, oneWayMs, timerLateMs });
            expect(sent.length).toBeGreaterThan(5);
            expect(sent.filter((s) => !s.accepted), `fps ${fps} phase ${phase} one-way ${oneWayMs} late ${timerLateMs}`).toEqual([]);
          }
        }
      }
    }
  });

  it('sends the first input on the first live frame, not a tick later', () => {
    for (const fps of FPS) {
      for (const phase of PHASES) {
        const sent = run({ fps, phase, oneWayMs: 5, timerLateMs: 1 });
        expect(sent[0].sentAt).toBeGreaterThanOrEqual(roundLiveAt(START));
        expect(sent[0].sentAt).toBeLessThan(roundLiveAt(START) + 1000 / fps);
        // One input per tick from there on: no burst, no gap.
        const spacing = (sent[6].sentAt - sent[0].sentAt) / 6;
        expect(Math.abs(spacing - CONFIG.TICK_MS)).toBeLessThan(1000 / fps / 6 + 0.01);
      }
    }
  });

  it('a balloon pressed at SPLASH! rides the first input and is accepted (no vanishing ghost)', () => {
    for (const fps of FPS) {
      for (const phase of PHASES) {
        // Any time from SPLASH! to the server's first tick.
        for (let at = 0; at <= CONFIG.TICK_MS; at += 2.5) {
          for (const oneWayMs of [1, 10, 30]) {
            const sent = run({ fps, phase, oneWayMs, timerLateMs: 1, balloonAt: at });
            expect(sent[0], `pressed at SPLASH!+${at} ms, ${fps} fps`).toMatchObject({ seq: 1, balloon: true, accepted: true });
            expect(sent.filter((s) => s.balloon)).toHaveLength(1);
          }
        }
      }
    }
  });

  it('a direction pressed at SPLASH! moves on the first input', () => {
    const sent = run({ fps: 60, phase: 0.4, oneWayMs: 5, timerLateMs: 1, dirPressAt: 3 });
    expect(sent[0].sentAt).toBeLessThan(roundLiveAt(START) + 1000 / 60);
    expect(sent[0].accepted).toBe(true);
  });

  it('a balloon pressed during the 3-2-1 is still dropped (no phantom balloon on the first tick)', () => {
    // At least a frame before SPLASH!, so a frame of the 3-2-1 sees the press.
    for (const at of [-900, -120, -34, -18]) {
      for (const phase of PHASES) {
        const sent = run({ fps: 60, phase, oneWayMs: 5, timerLateMs: 1, balloonAt: at });
        expect(sent.some((s) => s.balloon), `pressed at SPLASH!${at} ms`).toBe(false);
      }
    }
  });
});
