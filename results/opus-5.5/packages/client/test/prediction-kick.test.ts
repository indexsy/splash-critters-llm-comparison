// Kick prediction: a player with Rubber Boots kicks a balloon and walks on behind it on the very
// tick the server would, so snapshots never correct the kicker (the kick used to wait a round
// trip, then lurch the critter forward by up to a tile). Driven through MatchState against a
// lockstep server that runs the real sim `lag` ticks behind, with events and snapshots
// delivered `lag` ticks after they happen.
import {
  CONFIG,
  Dir,
  Tile,
  cloneState,
  encodeTiles,
  generateMap,
  makeRules,
  simulateTick,
  snapshotBody,
  spawnBalloon,
  tileCenter,
  type GameEvent,
  type MatchConfig,
  type RoundState,
} from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { MatchState } from '../src/game/matchState';
import { createSeqCounter } from '../src/prediction';

/** First client tick of the test: the round went live (its first server tick) before it. */
const START = 10_000;
const KICK_ROW = 1;
const BALLOON_TX = 3;

function config(): MatchConfig {
  return {
    matchId: 'm-kick',
    mode: 'duel',
    ranked: false,
    practice: false,
    tutorial: false,
    roomCode: 'ABC234',
    roundsToWin: 3,
    theme: 'beach',
    w: 13,
    h: 11,
    rules: makeRules({ ranked: false }),
    players: [
      { slot: 0, playerId: 'p-1', name: 'Kicker', tag: '0042', isBot: false, animal: 'duck', hat: 'none', level: 3 },
      { slot: 1, playerId: null, name: 'Bubbles', tag: '', isBot: true, difficulty: 'easy', animal: 'cat', hat: 'crown', level: 1 },
    ],
    yourSlot: 0,
  };
}

/** A live round whose top row is open floor from wall to wall; the server holds a balloon on it. */
function kickRound(canKick: boolean): { m: MatchState; server: RoundState } {
  const map = generateMap('duel', 1234);
  for (let x = 1; x < map.w - 1; x++) map.tiles[KICK_ROW * map.w + x] = Tile.Floor;
  const m = new MatchState(createSeqCounter());
  m.startMatch(config(), 0);
  m.startRound(
    {
      type: 'round_start',
      roundNo: 1,
      mapSeed: 99,
      castleGrid: encodeTiles(map.tiles),
      theme: 'beach',
      w: map.w,
      h: map.h,
      startTime: START - 2 * CONFIG.TICK_MS,
      spawns: map.spawns.map((s) => ({ slot: s.slot, x: s.tx, y: s.ty })),
      scores: [0, 0],
      tideStartTick: CONFIG.TIDE_START_TICKS,
    },
    START - 3000,
  );
  const server = cloneState(m.auth!);
  server.players[0].canKick = canKick;
  spawnBalloon(server, { owner: 1, tx: BALLOON_TX, ty: KICK_ROW, burstTick: 100_000, range: 1, fromDuck: false });
  m.applySnapshot({ type: 'snapshot', ...snapshotBody(server), serverTime: START, ack: 0, pings: [] }, START);
  return { m, server };
}

interface KickRun {
  m: MatchState;
  server: RoundState;
  /** Local critter x right after each predicted tick, by input seq. */
  predictedX: Map<number, number>;
  /** Server critter x right after it applied each input, by seq. */
  serverX: Map<number, number>;
  corrections: number[];
  kickSeq: number | null;
  kickSounds: number;
}

/** Hold Right for `ticks` client ticks against a server `lag` ticks away (each way). */
function holdRight(lag: number, canKick: boolean, ticks = 100): KickRun {
  const { m, server } = kickRound(canKick);
  const toServer: { due: number; seq: number }[] = [];
  const toClient: { due: number; run: () => void }[] = [];
  const run: KickRun = { m, server, predictedX: new Map(), serverX: new Map(), corrections: [], kickSeq: null, kickSounds: 0 };
  let ack = 0;
  for (let t = 0; t < ticks; t++) {
    const now = START + t * CONFIG.TICK_MS;
    const input = m.localTick(Dir.Right, false, now);
    if (!input) throw new Error(`no input at tick ${t}`);
    if (m.consumeKickSound()) run.kickSounds++;
    run.predictedX.set(input.seq, m.predicted!.players[0].x);
    toServer.push({ due: t + lag, seq: input.seq });
    for (const arrived of toServer.filter((i) => i.due === t)) {
      const events: GameEvent[] = simulateTick(server, [{ seq: arrived.seq, dir: Dir.Right, balloon: false }, null]);
      ack = arrived.seq;
      run.serverX.set(arrived.seq, server.players[0].x);
      if (events.some((e) => e.type === 'balloon_kicked')) run.kickSeq = arrived.seq;
      const tick = server.tick;
      if (events.length > 0) {
        toClient.push({
          due: t + lag,
          run: () => {
            for (const ev of events) {
              m.applyEvent(ev, tick);
              if (ev.type === 'balloon_kicked' && !m.isHeardKick(ev.id, ev.slot)) run.kickSounds++;
            }
          },
        });
      }
      if (tick % CONFIG.SNAPSHOT_EVERY_TICKS === 0) {
        const snap = { type: 'snapshot' as const, ...snapshotBody(server), serverTime: now, ack, pings: [] };
        toClient.push({ due: t + lag, run: () => run.corrections.push(m.applySnapshot(snap, now)?.correctionUnits ?? -1) });
      }
    }
    for (const msg of toClient.filter((c) => c.due === t)) msg.run();
  }
  return run;
}

describe('kick prediction', () => {
  it('kicks on the same tick as the server and never corrects the kicker, at any latency', () => {
    for (const lag of [1, 3, 5]) {
      const r = holdRight(lag, true);
      expect(r.kickSeq, `lag ${lag}: the server kicked`).not.toBeNull();
      // Tick by tick, the predicted critter is where the server puts it for the same input.
      for (const [seq, x] of r.serverX) expect(r.predictedX.get(seq), `lag ${lag}, seq ${seq}`).toBe(x);
      expect(r.corrections.length).toBeGreaterThan(5);
      expect(r.corrections.every((c) => c === 0), `lag ${lag}: corrections ${r.corrections.join(',')}`).toBe(true);
      // The kicker followed the balloon down the row; both worlds agree on where it stopped.
      const b = r.server.balloons[0];
      expect(b).toMatchObject({ tx: r.server.w - 2, ty: KICK_ROW, slideDir: Dir.None });
      expect(r.m.predicted!.balloons[0]).toMatchObject({ x: b.x, y: b.y, slideDir: Dir.None });
      expect(r.server.players[0].x).toBe(tileCenter(r.server.w - 3));
    }
  });

  it('without Rubber Boots the balloon blocks both worlds alike (no kick, no correction)', () => {
    const r = holdRight(4, false);
    expect(r.kickSeq).toBeNull();
    expect(r.corrections.every((c) => c === 0)).toBe(true);
    expect(r.m.predicted!.players[0].x).toBe(tileCenter(BALLOON_TX - 1));
    expect(r.m.predicted!.balloons[0]).toMatchObject({ tx: BALLOON_TX, slideDir: Dir.None });
    expect(r.kickSounds).toBe(0);
  });

  it('sounds the kick once, when predicted, and keeps the server echo silent', () => {
    const r = holdRight(5, true);
    expect(r.kickSounds).toBe(1);
  });

  it('draws the own kicked balloon with the critter: led by alpha, stopping where the slide stops', () => {
    const { m } = kickRound(true);
    let seq = 0;
    for (let t = 0; t < 40 && m.ownSlides(0).size === 0; t++) seq = m.localTick(Dir.Right, false, START + t * CONFIG.TICK_MS)!.seq;
    expect(seq).toBeGreaterThan(0);
    const b = m.predicted!.balloons[0];
    expect(b.slideDir).toBe(Dir.Right);
    expect(m.ownSlides(0).get(b.id)).toEqual({ x: b.x, y: b.y });
    const half = m.ownSlides(0.5).get(b.id)!;
    expect(half.x).toBeGreaterThan(b.x);
    expect(half.y).toBe(b.y);
    // Leading never moves the world itself.
    expect(m.predicted!.balloons[0].x).toBe(b.x);
    // Slide it into the far wall: the lead ends at the last free tile's center.
    for (let t = 40; t < 80; t++) m.localTick(Dir.None, false, START + t * CONFIG.TICK_MS);
    const stopped = m.predicted!.balloons[0];
    expect(stopped).toMatchObject({ tx: m.predicted!.w - 2, slideDir: Dir.None });
    expect(m.ownSlides(1).has(stopped.id)).toBe(false);
  });

  it('keeps sliding a server-confirmed own kick on replay after its input was acknowledged', () => {
    const r = holdRight(5, true, 30);
    expect(r.kickSeq).not.toBeNull();
    const predictedBall = r.m.predicted!.balloons[0];
    const authBall = r.m.auth!.balloons[0];
    // The snapshot shows the kick and has acked it; the prediction is still ahead of it.
    expect(authBall.slideDir).toBe(Dir.Right);
    expect(predictedBall.x).toBeGreaterThan(authBall.x);
    expect(r.corrections.every((c) => c === 0)).toBe(true);
  });

  it('never predicts a balloon somebody else kicked', () => {
    const { m, server } = kickRound(true);
    const id = server.balloons[0].id;
    m.applyEvent({ type: 'balloon_kicked', id, slot: 1, dir: Dir.Left }, 1);
    const before = m.predicted!.balloons[0].x;
    for (let t = 0; t < 3; t++) m.localTick(Dir.None, false, START + t * CONFIG.TICK_MS);
    expect(m.predicted!.balloons[0].x).toBe(before);
    expect(m.ownSlides(0.5).size).toBe(0);
    expect(m.isHeardKick(id, 1)).toBe(false);
  });
});
