// Remote critters as drawn: interpolated INTERP_DELAY_MS (plus network lateness) in the past.
// A lockstep server runs the real sim at 30 Hz and sends events every tick and snapshots every
// second tick (the order of MatchRunner.step) over an in-order link; the client is the real
// MatchState, fed like GameSession (events applied on arrival, held presentations released each
// frame) and sampled at 60 fps like the renderer.
import {
  CONFIG,
  Dir,
  idx,
  simulateTick,
  snapshotBody,
  speedUnitsPerTick,
  tileOf,
  type DirCode,
  type GameEvent,
  type SnapshotMsg,
} from '@splash/shared';
import { describe, expect, it } from 'vitest';
import type { DueEvent, MatchState } from '../src/game/matchState';
import { buildRoundWorld } from '../src/game/world';
import { START, duelConfig, matchInRound, openRoundStart } from './match-fixtures';

const FRAME_MS = 1000 / 60;
const SUB = CONFIG.SUB;
/** The remote critter (slot 1) runs right along this row; the local one idles at (1, 1). */
const ROW = 9;
const SPLASH_TX = 6;

type Arrival = { at: number; tick: number } & ({ snap: SnapshotMsg } | { events: GameEvent[] });

interface Link {
  latencyMs: number;
  jitterMs: number;
}

/**
 * Server side: `ticks` sim ticks with the remote holding `dir` from tick `fromTick`, and a splash
 * lingering on (SPLASH_TX, ROW) once it gets close (`splash`). Returns what the client receives.
 */
function serve(opts: { ticks: number; speedUps: number; splash: boolean; link: Link }): { arrivals: Arrival[]; soakTick: number; soakX: number } {
  const server = buildRoundWorld(duelConfig(), openRoundStart([{ slot: 0, x: 1, y: 1 }, { slot: 1, x: 1, y: ROW }]));
  server.players[1].speedUps = opts.speedUps;
  const arrivals: Arrival[] = [];
  let seed = 7 + opts.speedUps * 13 + opts.link.latencyMs;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let last = 0;
  let soakTick = -1;
  let soakX = 0;
  for (let t = 1; t <= opts.ticks; t++) {
    if (opts.splash && server.splashUntil[idx(server.w, SPLASH_TX, ROW)] === 0 && server.players[1].x >= (SPLASH_TX - 1) * SUB) {
      const i = idx(server.w, SPLASH_TX, ROW);
      server.splashUntil[i] = server.tick + CONFIG.SPLASH_TICKS;
      server.splashOwner[i] = 0;
    }
    const events = simulateTick(server, [null, { seq: t, dir: Dir.Right as DirCode, balloon: false }]);
    if (events.some((e) => e.type === 'player_soaked')) {
      soakTick = server.tick;
      soakX = server.players[1].x;
    }
    const sentAt = START + server.tick * CONFIG.TICK_MS;
    const at = (last = Math.max(last, sentAt + opts.link.latencyMs + rand() * opts.link.jitterMs));
    if (events.length > 0) arrivals.push({ at, tick: server.tick, events });
    if (server.tick % CONFIG.SNAPSHOT_EVERY_TICKS === 0) {
      arrivals.push({ at, tick: server.tick, snap: { type: 'snapshot', ...snapshotBody(server), serverTime: Math.round(sentAt), ack: 0, pings: [] } });
    }
  }
  return { arrivals, soakTick, soakX };
}

interface Frame {
  now: number;
  /** The remote critter as drawn, or null when it is not drawn as a dry critter. */
  remote: { x: number; y: number } | null;
  presented: (DueEvent & { held: boolean })[];
}

/** Client side: GameSession's order each frame (arrivals, held releases, then the scene). */
function play(m: MatchState, arrivals: Arrival[], from: number, until: number): Frame[] {
  const frames: Frame[] = [];
  let next = 0;
  for (let now = from; now < until; now += FRAME_MS) {
    const presented: Frame['presented'] = [];
    for (; next < arrivals.length && arrivals[next].at <= now; next++) {
      const a = arrivals[next];
      if ('snap' in a) m.applySnapshot(a.snap, a.at);
      else {
        for (const ev of a.events) {
          m.applyEvent(ev, a.tick);
          if (!m.holdPresentation(ev, a.tick, now)) presented.push({ ev, tick: a.tick, at: null, held: false });
        }
      }
    }
    for (const due of m.releaseHeld(now, now)) presented.push({ ...due, held: true });
    const remote = m.actors(now).find((a) => a.slot === 1);
    frames.push({ now, remote: remote?.alive ? { x: remote.x, y: remote.y } : null, presented });
  }
  return frames;
}

const soakOf = (f: Frame) => f.presented.find((p) => p.ev.type === 'player_soaked');

describe('remote soaks', () => {
  const links: Link[] = [
    { latencyMs: 20, jitterMs: 0 },
    { latencyMs: 50, jitterMs: 0 },
    { latencyMs: 50, jitterMs: 30 },
    { latencyMs: 100, jitterMs: 40 },
  ];

  it('are shown where the server soaked the critter, after it visibly reaches the water', () => {
    for (const speedUps of [0, 3, 8]) {
      for (const link of links) {
        const m = matchInRound(duelConfig(), openRoundStart([{ slot: 0, x: 1, y: 1 }, { slot: 1, x: 1, y: ROW }]));
        const { arrivals, soakTick, soakX } = serve({ ticks: 120, speedUps, splash: true, link });
        expect(soakTick).toBeGreaterThan(0);
        const frames = play(m, arrivals, START, START + 5000);
        const at = frames.findIndex((f) => soakOf(f));
        const label = `speedUps ${speedUps}, ${link.latencyMs}+${link.jitterMs} ms`;
        const soak = soakOf(frames[at])!;
        expect(soak.held, label).toBe(true);
        // The puddle lands on the soak tile, within a tick's walk of where the server had it.
        expect(tileOf(soak.at!.x), label).toBe(SPLASH_TX);
        expect(tileOf(soak.at!.y), label).toBe(ROW);
        expect(Math.abs(soakX - soak.at!.x), label).toBeLessThanOrEqual(speedUnitsPerTick(speedUps));
        // Until then the critter is drawn dry and running, and it never jumps.
        const before = frames.slice(0, at).filter((f) => f.remote);
        expect(before.length, label).toBeGreaterThan(0);
        const lastDrawn = before[before.length - 1].remote!;
        expect(Math.abs(soak.at!.x - lastDrawn.x), label).toBeLessThanOrEqual(speedUnitsPerTick(speedUps));
        expect(frames[at].remote, label).toBeNull();
      }
    }
  });

  it('hold the round_over they decide until the soak is shown', () => {
    const m = matchInRound(duelConfig(), openRoundStart([{ slot: 0, x: 1, y: 1 }, { slot: 1, x: 1, y: ROW }]));
    const { arrivals } = serve({ ticks: 120, speedUps: 0, splash: true, link: { latencyMs: 40, jitterMs: 0 } });
    const shown = play(m, arrivals, START, START + 5000).flatMap((f) => f.presented.map((p) => p.ev.type));
    expect(shown.filter((t) => t === 'player_soaked' || t === 'round_over')).toEqual(['player_soaked', 'round_over']);
  });

  it('are shown anyway when the render clock stalls (no snapshot reaches the soak tick)', () => {
    const m = matchInRound(duelConfig(), openRoundStart([{ slot: 0, x: 1, y: 1 }, { slot: 1, x: 1, y: ROW }]));
    const now = START + 1000;
    // The newest snapshot (tick 18) came 400 ms late: the render clock is far behind tick 29.
    m.applySnapshot({ type: 'snapshot', ...snapshotBody(m.auth!), tick: 18, serverTime: START + 600, ack: 0, pings: [] }, now);
    const ev: GameEvent = { type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 4, y: ROW };
    m.applyEvent(ev, 29);
    expect(m.holdPresentation(ev, 29, now)).toBe(true);
    expect(m.actors(now).find((a) => a.slot === 1)?.alive).toBe(true);
    expect(m.releaseHeld(now + 350, now + 350)).toEqual([]);
    const [due] = m.releaseHeld(now + 500, now + 500);
    expect(due.ev).toBe(ev);
    expect({ tx: tileOf(due.at!.x), ty: tileOf(due.at!.y) }).toEqual({ tx: 4, ty: ROW });
    expect(m.actors(now + 500).find((a) => a.slot === 1)?.alive).toBe(false);
  });

  it('the local critter is never held: its soak shows at once where it is drawn', () => {
    const m = matchInRound(duelConfig(), openRoundStart([{ slot: 0, x: 1, y: 1 }, { slot: 1, x: 1, y: ROW }]));
    const ev: GameEvent = { type: 'player_soaked', slot: 0, by: 1, cause: 'splash', x: 1, y: 1 };
    m.applyEvent(ev, 30);
    expect(m.holdPresentation(ev, 30, START + 1000)).toBe(false);
  });
});

describe('round start', () => {
  it('remote critters leave their spawns smoothly: no pop to the first snapshot, no hold', () => {
    for (const latencyMs of [10, 40, 90]) {
      const m = matchInRound(duelConfig(), openRoundStart([{ slot: 0, x: 1, y: 1 }, { slot: 1, x: 1, y: ROW }]));
      const spawnX = m.predicted!.players[1].x;
      // The remote (a bot, or a human on a fast link) moves from tick 1.
      const { arrivals } = serve({ ticks: 40, speedUps: 0, splash: false, link: { latencyMs, jitterMs: 0 } });
      const frames = play(m, arrivals, START - 200, START + 900);
      const xs = frames.map((f) => f.remote!.x);
      expect(xs[0]).toBe(spawnX);
      const steps = xs.slice(1).map((x, i) => x - xs[i]);
      // A 60 fps frame is half a tick of walking; the pop used to be four times that.
      const perFrame = speedUnitsPerTick(0) / 2;
      expect(Math.max(...steps), `${latencyMs} ms`).toBeLessThanOrEqual(perFrame * 1.05);
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
      // Once moving it keeps moving (the pop was followed by a ~100 ms stand-still).
      const moving = steps.findIndex((d) => d > 0);
      const stalls = steps.slice(moving, moving + 20).filter((d) => d === 0);
      expect(stalls, `${latencyMs} ms`).toEqual([]);
    }
  });
});
