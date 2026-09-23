// Local prediction + rewind-replay reconciliation against a simulated lagging server.
import {
  CONFIG,
  Dir,
  Tile,
  applySnapshotToState,
  cloneState,
  createRoundState,
  makeRules,
  simulateTick,
  snapshotBody,
  spawnBalloon,
  type DirCode,
  type GeneratedMap,
  type RoundState,
  type SnapshotMsg,
} from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { LocalPredictor, VisualError, createSeqCounter, localPosition, prunePending } from '../src/prediction';

/** 9x7 open arena: border boulders, pillars at even/even, floor everywhere else. */
function openMap(): GeneratedMap {
  const w = 9;
  const h = 7;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = border || (x % 2 === 0 && y % 2 === 0) ? Tile.Boulder : Tile.Floor;
    }
  }
  return { w, h, tiles, hidden: new Uint8Array(w * h), spawns: [{ slot: 0, tx: 1, ty: 1 }, { slot: 1, tx: 7, ty: 5 }] };
}

interface Wire<T> {
  due: number;
  msg: T;
}

/**
 * Lockstep harness: a client that predicts every tick and a server that applies each input
 * `lag` ticks later and sends a snapshot every SNAPSHOT_EVERY_TICKS ticks, delivered `lag`
 * ticks after that. `serverHook` may change the server world (things the client cannot foresee).
 */
function runNetcode(dirs: DirCode[], lag: number, serverHook?: (s: RoundState) => void) {
  const map = openMap();
  const server = createRoundState(map, [true, true], makeRules({ ranked: false }));
  const auth = cloneState(server);
  let predicted = cloneState(server);
  const predictor = new LocalPredictor(0, createSeqCounter());
  const toServer: Wire<{ seq: number; dir: DirCode }>[] = [];
  const toClient: Wire<SnapshotMsg>[] = [];
  let ack = 0;
  let lastSeq = 0;
  const totalTicks = dirs.length + lag * 3 + 10;
  for (let t = 0; t < totalTicks; t++) {
    const dir = t < dirs.length ? dirs[t] : Dir.None;
    const { seq } = predictor.tick(predicted, dir);
    lastSeq = seq;
    toServer.push({ due: t + lag, msg: { seq, dir } });
    const arrived = toServer.filter((m) => m.due === t);
    const input = arrived[0]?.msg;
    if (input) ack = input.seq;
    serverHook?.(server);
    simulateTick(server, [input ? { seq: input.seq, dir: input.dir, balloon: false } : null, null]);
    if (server.tick % CONFIG.SNAPSHOT_EVERY_TICKS === 0) {
      toClient.push({ due: t + lag, msg: { type: 'snapshot', ...snapshotBody(server), serverTime: t, ack, pings: [0, -1] } });
    }
    for (const snap of toClient.filter((m) => m.due === t)) {
      applySnapshotToState(auth, snap.msg);
      predicted = predictor.reconcile(auth, snap.msg.ack);
    }
  }
  return { server, predicted, predictor, lastSeq, ack };
}

const PATH: DirCode[] = [
  ...Array<DirCode>(14).fill(Dir.Right),
  ...Array<DirCode>(9).fill(Dir.Down),
  ...Array<DirCode>(6).fill(Dir.Left),
  ...Array<DirCode>(4).fill(Dir.Up),
];

describe('local prediction', () => {
  it('matches a zero-latency simulation of the same inputs tick by tick', () => {
    const map = openMap();
    const ideal = createRoundState(map, [true, true], makeRules({ ranked: false }));
    const predicted = cloneState(ideal);
    const predictor = new LocalPredictor(0, createSeqCounter());
    for (const dir of PATH) {
      predictor.tick(predicted, dir);
      simulateTick(ideal, [{ seq: 0, dir, balloon: false }, null]);
      expect(localPosition(predicted, 0)).toEqual({ x: ideal.players[0].x, y: ideal.players[0].y });
    }
  });

  it('converges exactly to the server state after rewind-replay with latency', () => {
    for (const lag of [0, 2, 5, 9]) {
      const { server, predicted, predictor } = runNetcode(PATH, lag);
      expect(predicted.players[0].x).toBe(server.players[0].x);
      expect(predicted.players[0].y).toBe(server.players[0].y);
      // Unacknowledged inputs span one round trip plus the snapshot interval.
      expect(predictor.pendingCount).toBeLessThanOrEqual(2 * lag + CONFIG.SNAPSHOT_EVERY_TICKS + 1);
    }
  });

  it('corrects a misprediction the client could not foresee (a balloon appears in its path)', () => {
    let dropped = false;
    const { server, predicted } = runNetcode(Array<DirCode>(20).fill(Dir.Right), 4, (s) => {
      if (!dropped && s.tick === 3) {
        dropped = true;
        spawnBalloon(s, { owner: 1, tx: 4, ty: 1, burstTick: 10_000, range: 1, fromDuck: false });
      }
    });
    // Blocked by the balloon at (4,1): both end clamped at the center of tile (3,1).
    expect(server.players[0].x).toBe(3 * CONFIG.SUB + CONFIG.SUB / 2);
    expect(predicted.players[0].x).toBe(server.players[0].x);
    expect(predicted.balloons.map((b) => b.tx)).toEqual([4]);
  });

  it('never mutates the authoritative state while replaying', () => {
    const map = openMap();
    const auth = createRoundState(map, [true, true], makeRules({ ranked: false }));
    const before = auth.players[0].x;
    const predictor = new LocalPredictor(0, createSeqCounter());
    const predicted = cloneState(auth);
    for (let i = 0; i < 5; i++) predictor.tick(predicted, Dir.Right);
    const replayed = predictor.reconcile(auth, 0);
    expect(auth.players[0].x).toBe(before);
    expect(replayed.players[0].x).toBe(predicted.players[0].x);
  });
});

describe('pending inputs', () => {
  it('are pruned by the server ack', () => {
    const pending = [1, 2, 3, 4, 5].map((seq) => ({ seq, dir: Dir.Left as DirCode }));
    expect(prunePending(pending, 3).map((p) => p.seq)).toEqual([4, 5]);
    expect(prunePending(pending, 0)).toHaveLength(5);
    expect(prunePending(pending, 9)).toHaveLength(0);
  });

  it('drop acknowledged inputs on reconcile and keep the rest for replay', () => {
    const auth = createRoundState(openMap(), [true, true], makeRules({ ranked: false }));
    const predictor = new LocalPredictor(0, createSeqCounter());
    const predicted = cloneState(auth);
    for (let i = 0; i < 6; i++) predictor.tick(predicted, Dir.Right);
    predictor.reconcile(auth, 4);
    expect(predictor.pendingCount).toBe(2);
    predictor.reconcile(auth, 6);
    expect(predictor.pendingCount).toBe(0);
  });

  it('are capped at INPUT_BUFFER_TICKS (oldest dropped)', () => {
    const auth = createRoundState(openMap(), [true, true], makeRules({ ranked: false }));
    const predictor = new LocalPredictor(0, createSeqCounter());
    const predicted = cloneState(auth);
    for (let i = 0; i < CONFIG.INPUT_BUFFER_TICKS + 12; i++) predictor.tick(predicted, Dir.None);
    expect(predictor.pendingCount).toBe(CONFIG.INPUT_BUFFER_TICKS);
  });

  it('use one monotonic sequence across predictors (rounds)', () => {
    const next = createSeqCounter();
    const auth = createRoundState(openMap(), [true, true], makeRules({ ranked: false }));
    const a = new LocalPredictor(0, next);
    const b = new LocalPredictor(0, next);
    expect([a.tick(cloneState(auth), Dir.Up).seq, a.tick(cloneState(auth), Dir.Up).seq, b.tick(cloneState(auth), Dir.Up).seq]).toEqual([1, 2, 3]);
  });
});

describe('visual error smoothing', () => {
  it('absorbs a small correction so the drawn position does not jump, then decays to zero', () => {
    const err = new VisualError();
    const snapped = err.absorb({ x: 5000, y: 4500 }, { x: 4700, y: 4500 });
    expect(snapped).toBe(false);
    expect(err.x).toBe(300);
    err.decay(50);
    expect(err.x).toBeGreaterThan(0);
    expect(err.x).toBeLessThan(300 * 0.25);
    err.decay(200);
    expect(err.x).toBe(0);
  });

  it('snaps when the correction is larger than one tile', () => {
    const err = new VisualError();
    expect(err.absorb({ x: 1500, y: 1500 }, { x: 1500 + CONFIG.SUB + 1, y: 1500 })).toBe(true);
    expect(err.x).toBe(0);
    expect(err.y).toBe(0);
  });

  it('accumulates consecutive corrections from the currently drawn position', () => {
    const err = new VisualError();
    err.absorb({ x: 1000, y: 0 }, { x: 900, y: 0 });
    err.absorb({ x: 900, y: 0 }, { x: 850, y: 0 });
    expect(err.x).toBe(150);
  });
});
