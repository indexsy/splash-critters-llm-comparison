// Client match state: round world construction, event application to both worlds, intro
// gating of inputs, snapshot reconciliation through MatchState, clocks and announcer wording.
import {
  CONFIG,
  Dir,
  cloneState,
  PowerUp,
  Tile,
  createRoundState,
  encodeTiles,
  generateMap,
  makeRules,
  simulateTick,
  snapshotBody,
  tileCenter,
  type MatchConfig,
  type RoundStartMsg,
  type SnapshotMsg,
} from '@splash/shared';
import { describe, expect, it } from 'vitest';
import { createSeqCounter } from '../src/prediction';
import { FixedStep, TickEstimator, introPhase, roundLiveAt } from '../src/game/clock';
import { chainLabel, feedText, formatClockSeconds, killFeedLine } from '../src/game/labels';
import { matchLiveness } from '../src/game/liveness';
import { MatchState } from '../src/game/matchState';
import { aliveCount, applyWorldEvent, buildRoundWorld, isShowdown, presentSlots } from '../src/game/world';
import { balloonCenter } from '../src/render/world-hazards';

const SEED = 1234;

function config(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    matchId: 'm-1',
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
      { slot: 0, playerId: 'p-1', name: 'DuckyDan', tag: '0042', isBot: false, animal: 'duck', hat: 'none', level: 3 },
      { slot: 1, playerId: null, name: 'Bubbles', tag: '', isBot: true, difficulty: 'easy', animal: 'cat', hat: 'crown', level: 1 },
    ],
    yourSlot: 0,
    ...overrides,
  };
}

function roundStart(overrides: Partial<RoundStartMsg> = {}): RoundStartMsg {
  const map = generateMap('duel', SEED);
  return {
    type: 'round_start',
    roundNo: 1,
    mapSeed: 99,
    castleGrid: encodeTiles(map.tiles),
    theme: 'beach',
    w: map.w,
    h: map.h,
    startTime: 10_000,
    spawns: map.spawns.map((s) => ({ slot: s.slot, x: s.tx, y: s.ty })),
    scores: [0, 0],
    tideStartTick: CONFIG.TIDE_START_TICKS,
    ...overrides,
  };
}

describe('buildRoundWorld', () => {
  it('decodes the grid, never knows hidden contents and places spawns', () => {
    const map = generateMap('duel', SEED);
    const s = buildRoundWorld(config(), roundStart());
    expect(Array.from(s.tiles)).toEqual(Array.from(map.tiles));
    expect(s.hidden.every((v) => v === 0)).toBe(true);
    expect(s.players[0].x).toBe(1 * CONFIG.SUB + CONFIG.SUB / 2);
    expect(s.players[1].y).toBe((map.h - 2) * CONFIG.SUB + CONFIG.SUB / 2);
    expect(s.tick).toBe(0);
  });

  it('marks only seated players with a spawn as present', () => {
    const c = config({ mode: 'ffa', players: [config().players[0], { ...config().players[1], slot: 3 }] });
    const map = generateMap('ffa', SEED);
    const rs = roundStart({ castleGrid: encodeTiles(map.tiles), w: map.w, h: map.h, spawns: map.spawns.map((s) => ({ slot: s.slot, x: s.tx, y: s.ty })) });
    expect(presentSlots(c, rs)).toEqual([true, false, false, true]);
  });

  it('uses the round tide start and the resume tick', () => {
    const s = buildRoundWorld(config(), roundStart({ tideStartTick: 900, resumeTick: 420 }));
    expect(s.rules.tideStartTick).toBe(900);
    expect(s.nextTideTick).toBe(900);
    expect(s.tick).toBe(420);
  });

  it('accepts sub-unit spawn coordinates too', () => {
    const s = buildRoundWorld(config(), roundStart({ spawns: [{ slot: 0, x: 4500, y: 4500 }, { slot: 1, x: 11, y: 9 }] }));
    expect(s.players[0].x).toBe(4500);
    expect(s.players[1].x).toBe(11 * CONFIG.SUB + CONFIG.SUB / 2);
  });
});

describe('applyWorldEvent', () => {
  it('washes castles off the tile grid and tracks exposed items', () => {
    const s = buildRoundWorld(config(), roundStart());
    const i = Array.from(s.tiles).findIndex((t) => t === Tile.Castle);
    const x = i % s.w;
    const y = Math.floor(i / s.w);
    applyWorldEvent(s, { type: 'castle_washed', x, y, by: 0 }, 50);
    expect(s.tiles[i]).toBe(Tile.Floor);
    applyWorldEvent(s, { type: 'powerup_revealed', x, y, kind: PowerUp.Range }, 50);
    expect(s.items[i]).toBe(PowerUp.Range);
    applyWorldEvent(s, { type: 'powerup_collected', x, y, kind: PowerUp.Range, slot: 1 }, 51);
    expect(s.items[i]).toBe(PowerUp.None);
  });

  it('adds announced balloons with the server id and removes burst ones', () => {
    const s = buildRoundWorld(config(), roundStart());
    applyWorldEvent(s, { type: 'balloon_placed', id: 7, x: 1, y: 1, owner: 0 }, 40);
    expect(s.balloons).toHaveLength(1);
    expect(s.balloons[0]).toMatchObject({ id: 7, tx: 1, ty: 1, burstTick: 40 + CONFIG.FUSE_TICKS, range: CONFIG.RANGE_BASE });
    expect(s.balloons[0].passMask & 1).toBe(1);
    applyWorldEvent(s, { type: 'balloon_placed', id: 7, x: 1, y: 1, owner: 0 }, 40);
    expect(s.balloons).toHaveLength(1);
    applyWorldEvent(s, { type: 'balloon_burst', id: 7, x: 1, y: 1, owner: 0, arms: [0, 2, 0, 2], chainId: 7, fromDuck: false }, 130);
    expect(s.balloons).toHaveLength(0);
  });

  it('soaks players, raises the tide and ends the round', () => {
    const s = buildRoundWorld(config(), roundStart());
    applyWorldEvent(s, { type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 11, y: 9 }, 77);
    expect(s.players[1]).toMatchObject({ alive: false, soakedTick: 77, soakedBy: 0 });
    applyWorldEvent(s, { type: 'tide_advance', level: 2 }, 80);
    expect(s.tideLevel).toBe(2);
    applyWorldEvent(s, { type: 'round_over', winner: 0, draw: false }, 81);
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0);
  });
});

function liveMatch(): MatchState {
  const m = new MatchState(createSeqCounter());
  m.startMatch(config(), 0);
  m.startRound(roundStart({ startTime: 10_000 }), 7_000);
  return m;
}

/** When liveMatch's round takes inputs: its first server tick, one period after startTime. */
const LIVE = roundLiveAt(10_000);

describe('MatchState', () => {
  it('sends no input during the 3-2-1 intro nor at SPLASH!, then one per tick with rising seq', () => {
    const m = liveMatch();
    expect(m.phase(9_999)).toBe('countdown');
    expect(m.canAct(9_999)).toBe(false);
    expect(m.localTick(Dir.Right, true, 9_999)).toBeNull();
    // "SPLASH!" shows at startTime, but the server takes inputs only from tick 1, one period on.
    expect(m.phase(10_000)).toBe('countdown');
    expect(m.localTick(Dir.Right, true, 10_000)).toBeNull();
    expect(m.canAct(10_000 + CONFIG.TICK_MS)).toBe(false);
    expect(LIVE).toBeGreaterThan(10_000 + CONFIG.TICK_MS);
    expect(LIVE).toBeLessThan(10_000 + CONFIG.TICK_MS + 10);
    const a = m.localTick(Dir.Right, false, LIVE);
    const b = m.localTick(Dir.Right, true, LIVE + CONFIG.TICK_MS);
    expect(m.phase(LIVE)).toBe('live');
    expect(a).toMatchObject({ seq: 1, tick: 1, dir: Dir.Right, balloonPressed: false });
    expect(b).toMatchObject({ seq: 2, tick: 2, balloonPressed: true });
    expect(m.predicted!.players[0].x).toBeGreaterThan(m.auth!.players[0].x);
  });

  it('gates the input clock: presses dropped in the 3-2-1, kept from SPLASH! to the first tick', () => {
    const m = liveMatch();
    expect(m.inputGate(9_999)).toBe('drop');
    expect(m.inputGate(10_000)).toBe('hold');
    expect(m.inputGate(LIVE - 0.5)).toBe('hold');
    expect(m.inputGate(LIVE)).toBe('act');
    m.applyEvent({ type: 'round_over', winner: 1, draw: false }, 90);
    expect(m.inputGate(LIVE + 3000)).toBe('drop');
    const resumed = new MatchState(createSeqCounter());
    resumed.startMatch(config(), 0);
    resumed.startRound(roundStart({ startTime: 1_000, resumeTick: 600 }), 21_000);
    expect(resumed.inputGate(21_000)).toBe('act');
  });

  it('applies events to both the authoritative and the predicted grid', () => {
    const m = liveMatch();
    const i = Array.from(m.auth!.tiles).findIndex((t) => t === Tile.Castle);
    m.applyEvent({ type: 'castle_washed', x: i % m.auth!.w, y: Math.floor(i / m.auth!.w), by: 1 }, 5);
    expect(m.auth!.tiles[i]).toBe(Tile.Floor);
    expect(m.predicted!.tiles[i]).toBe(Tile.Floor);
  });

  it('reconciles on snapshots: acked inputs dropped, the rest replayed on the server state', () => {
    const m = liveMatch();
    const server = createRoundState(
      { w: m.auth!.w, h: m.auth!.h, tiles: m.auth!.tiles.slice(), hidden: new Uint8Array(m.auth!.w * m.auth!.h), spawns: [{ slot: 0, tx: 1, ty: 1 }, { slot: 1, tx: 11, ty: 9 }] },
      [true, true],
      makeRules({ ranked: false }),
    );
    const sent = [];
    for (let t = 0; t < 6; t++) sent.push(m.localTick(Dir.Down, false, LIVE + t * CONFIG.TICK_MS)!);
    // Server applied the first 4 inputs.
    for (const input of sent.slice(0, 4)) simulateTick(server, [{ seq: input.seq, dir: input.dir, balloon: false }, null]);
    const snap: SnapshotMsg = { type: 'snapshot', ...snapshotBody(server), serverTime: 10_140, ack: sent[3].seq, pings: [40, -1] };
    const drawnBefore = m.predicted!.players[0].y;
    m.applySnapshot(snap, 10_200);
    for (const input of sent.slice(4)) simulateTick(server, [{ seq: input.seq, dir: input.dir, balloon: false }, null]);
    expect(m.predicted!.players[0].y).toBe(server.players[0].y);
    expect(m.predicted!.players[0].y).toBe(drawnBefore);
    expect(m.pings).toEqual([40, -1]);
  });

  it('ignores snapshots older than the last one applied', () => {
    const m = liveMatch();
    const base = snapshotBody(m.auth!);
    m.applySnapshot({ type: 'snapshot', ...base, tick: 10, serverTime: 10_333, ack: 0, pings: [] }, 10_400);
    m.applySnapshot({ type: 'snapshot', ...base, tick: 8, tideLevel: 3, serverTime: 10_266, ack: 0, pings: [] }, 10_400);
    expect(m.auth!.tick).toBe(10);
    expect(m.auth!.tideLevel).toBe(0);
  });

  it('shows a ghost drop only where the sim would accept a balloon', () => {
    const m = liveMatch();
    m.localTick(Dir.None, true, LIVE);
    expect(m.predictDrop(0, 100)).toBe(true);
    expect(m.predictDrop(0, 100)).toBe(false); // cap of 1 balloon reached
    m.applyEvent({ type: 'balloon_placed', id: 3, x: 1, y: 1, owner: 0 }, 1);
    m.pruneDrops(10);
    expect(m.ghostDrops).toHaveLength(0);
  });

  it('keeps the round result until the next round_start', () => {
    const m = liveMatch();
    m.endRound({ type: 'round_end', roundNo: 1, winner: 1, scores: [0, 1], summaries: [], matchOver: false }, 5);
    expect(m.phase(20_000)).toBe('result');
    expect(m.canAct(20_000)).toBe(false);
    m.startRound(roundStart({ roundNo: 2, startTime: 30_000, scores: [0, 1] }), 27_000);
    expect(m.phase(29_000)).toBe('countdown');
    expect(m.scores).toEqual([0, 1]);
  });

  it('resumes mid-round without a countdown', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(config(), 0);
    m.startRound(roundStart({ startTime: 1_000, resumeTick: 600 }), 21_000);
    expect(m.round!.resumed).toBe(true);
    expect(m.phase(21_000)).toBe('live');
    expect(Math.floor(m.estTick(21_000))).toBe(600);
    expect(m.localTick(Dir.Left, false, 21_000)).not.toBeNull();
  });

  it('after a mid-round re-join critters appear with the first snapshot, placed at once (no slide)', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(config(), 0);
    m.startRound(roundStart({ startTime: 1_000, resumeTick: 600 }), 21_000);
    const server = cloneState(m.auth!);
    server.players[0].y += CONFIG.SUB / 2;
    const snap: SnapshotMsg = { type: 'snapshot', ...snapshotBody(server), serverTime: 21_000, ack: 0, pings: [] };
    expect(m.actors(21_010)).toEqual([]);
    expect(m.applySnapshot(snap, 21_050)).toMatchObject({ correctionUnits: null, snapped: false });
    expect(m.actors(21_050).find((a) => a.local)?.y).toBe(server.players[0].y);
    const later = { ...snap, ...snapshotBody(server), tick: snap.tick + 2 };
    expect(m.applySnapshot(later, 21_120)).toMatchObject({ correctionUnits: 0, snapped: false });
  });

  it('a re-sync during the 3-2-1 (resumeTick 0) keeps the countdown and the start-time anchor', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(config(), 0);
    m.startRound(roundStart({ startTime: 10_000, resumeTick: 0 }), 8_000);
    expect(m.round!.resumed).toBe(false);
    expect(m.phase(9_000)).toBe('countdown');
    expect(m.estTick(9_000)).toBe(0);
    expect(m.localTick(Dir.Left, false, 9_000)).toBeNull();
    expect(m.estTick(10_000 + 10 * CONFIG.TICK_MS)).toBeCloseTo(10);
  });
});

describe('clocks', () => {
  it('FixedStep runs whole 30 Hz steps and caps catch-up after a stall', () => {
    const step = new FixedStep(CONFIG.TICK_MS, 4);
    expect(step.advance(16)).toBe(0);
    expect(step.advance(18)).toBe(1);
    expect(step.advance(1000)).toBe(4);
    expect(step.advance(10)).toBe(0);
  });

  it('TickEstimator extrapolates from the anchor and never rewinds on jitter', () => {
    const est = new TickEstimator();
    est.reset({ tick: 0, serverTime: 1000 });
    expect(est.now(1000 + CONFIG.TICK_MS * 30)).toBeCloseTo(30);
    est.observe({ tick: 28, serverTime: 1000 + CONFIG.TICK_MS * 29 });
    expect(est.now(1000 + CONFIG.TICK_MS * 30)).toBeCloseTo(30);
    est.observe({ tick: 900, serverTime: 5000 });
    expect(est.now(5000)).toBe(900);
  });

  it('introPhase counts 3-2-1 then SPLASH!', () => {
    expect(introPhase(0, 3000)).toMatchObject({ kind: 'count', n: 3 });
    expect(introPhase(1500, 3000)).toMatchObject({ kind: 'count', n: 2 });
    expect(introPhase(2999, 3000)).toMatchObject({ kind: 'count', n: 1 });
    expect(introPhase(3000, 3000).kind).toBe('go');
    expect(introPhase(5000, 3000).kind).toBe('none');
  });
});

describe('labels', () => {
  it('escalates chain calls', () => {
    expect([2, 3, 4, 5, 9].map(chainLabel)).toEqual(['DOUBLE SPLASH!', 'TRIPLE SPLASH!', 'QUAD SPLASH!', 'MEGA SPLASH!', 'MEGA SPLASH!']);
  });

  it('formats the tide clock', () => {
    expect(formatClockSeconds(120)).toBe('2:00');
    expect(formatClockSeconds(59.2)).toBe('1:00');
    expect(formatClockSeconds(9)).toBe('0:09');
    expect(formatClockSeconds(-3)).toBe('0:00');
  });

  it('writes kill-feed lines for soaks, self-soaks, the tide and revenge lobs', () => {
    const names = ['DuckyDan', 'SoggyCat'];
    const nameOf = (s: number) => names[s];
    expect(feedText(killFeedLine({ type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 0, y: 0 }, nameOf, 0))).toBe('DuckyDan soaked SoggyCat!');
    expect(feedText(killFeedLine({ type: 'player_soaked', slot: 1, by: 1, cause: 'splash', x: 0, y: 0 }, nameOf, 0))).toBe('SoggyCat soaked themselves!');
    expect(feedText(killFeedLine({ type: 'player_soaked', slot: 0, by: -1, cause: 'tide', x: 0, y: 0 }, nameOf, 0))).toBe('DuckyDan got washed away by the tide!');
    const revenge = killFeedLine({ type: 'player_soaked', slot: 0, by: 1, cause: 'revenge', x: 0, y: 0 }, nameOf, 0);
    expect(revenge.revenge).toBe(true);
    expect(revenge.mine).toBe(true);
  });
});

function ffaConfig(): MatchConfig {
  const base = config().players[0];
  const names = ['DuckyDan', 'SoggyCat', 'Capy', 'Otterly'];
  const players = names.map((name, slot) => ({ ...base, slot, playerId: `p-${slot}`, name }));
  return config({ mode: 'ffa', ranked: true, w: 15, h: 13, rules: makeRules({ ranked: true }), players });
}

/** An FFA round_start; the server only sends spawns for the slots taking part. */
function ffaRoundStart(spawned: readonly number[], overrides: Partial<RoundStartMsg> = {}): RoundStartMsg {
  const map = generateMap('ffa', SEED);
  const spawns = map.spawns.filter((s) => spawned.includes(s.slot)).map((s) => ({ slot: s.slot, x: s.tx, y: s.ty }));
  return roundStart({ castleGrid: encodeTiles(map.tiles), w: map.w, h: map.h, spawns, scores: [0, 0, 0, 0], ...overrides });
}

function ffaSnapshot(present: boolean[], serverTime: number): SnapshotMsg {
  const server = createRoundState(generateMap('ffa', SEED), present, makeRules({ ranked: true }));
  return { type: 'snapshot', ...snapshotBody(server), serverTime, ack: 0, pings: [] };
}

const FORFEITED = { connected: false, replacedByBot: false, forfeited: true };

describe('ranked forfeits', () => {
  it('a slot missing from the snapshot leaves the round (no frozen phantom critter)', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(ffaConfig(), 0);
    m.startRound(ffaRoundStart([0, 1, 2, 3]), 7_000);
    m.applySnapshot(ffaSnapshot([true, true, true, false], 10_100), 10_150);
    expect(m.actors(10_200).map((a) => a.slot)).toEqual([0, 1, 2]);
    expect(m.auth!.players[3]).toMatchObject({ present: false, alive: false });
    expect(aliveCount(m.predicted!)).toBe(3);
  });

  it('player_status forfeited removes the critter at once and from later rounds', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(ffaConfig(), 0);
    m.startRound(ffaRoundStart([0, 1, 2, 3]), 7_000);
    m.setStatus(3, FORFEITED);
    expect(m.predicted!.players[3]).toMatchObject({ present: false, alive: false });
    expect(m.auth!.players[3].present).toBe(false);
    // Even if a server still listed a spawn for the leaver, the next round leaves them out.
    m.startRound(ffaRoundStart([0, 1, 2, 3], { roundNo: 2, startTime: 30_000 }), 27_000);
    expect(m.predicted!.players.map((p) => p.present)).toEqual([true, true, true, false]);
  });
});

describe('final round verdict', () => {
  const finalRound = (winner: number, scores: number[]) => ({ type: 'round_end' as const, roundNo: 15, winner, scores, summaries: [], matchOver: true });
  const ffaMatch = (spawned: number[] = [0, 1, 2, 3]) => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(ffaConfig(), 0);
    m.startRound(ffaRoundStart(spawned, { roundNo: 15 }), 7_000);
    return m;
  };

  it('names the match winner from the round wins, not the winner of the last round (MAX_ROUNDS)', () => {
    const m = ffaMatch();
    m.endRound(finalRound(1, [4, 1, 3, 2]), 5);
    expect(m.result!.verdict).toEqual({ kind: 'winner', slot: 0 });
    const draw = ffaMatch();
    draw.endRound(finalRound(-1, [4, 1, 3, 2]), 5);
    expect(draw.result!.verdict).toEqual({ kind: 'winner', slot: 0 });
  });

  it('a forfeited leader cannot win: by player_status, or by missing from the final round', () => {
    const byStatus = ffaMatch();
    byStatus.setStatus(0, FORFEITED);
    byStatus.endRound(finalRound(1, [4, 3, 1, 0]), 5);
    expect(byStatus.result!.verdict).toEqual({ kind: 'winner', slot: 1 });
    const absent = ffaMatch([1, 2, 3]);
    absent.endRound(finalRound(1, [4, 3, 1, 0]), 5);
    expect(absent.result!.verdict).toEqual({ kind: 'winner', slot: 1 });
  });

  it('a tie on round wins waits for match_end placements (soak tiebreak)', () => {
    const m = ffaMatch();
    m.endRound(finalRound(2, [3, 3, 1, 0]), 5);
    expect(m.result!.verdict).toEqual({ kind: 'pending' });
    const placements = [1, 0, 2, 3].map((slot, i) => ({ slot, placement: i + 1 }));
    m.endMatch(placements);
    expect(m.result!.verdict).toEqual({ kind: 'winner', slot: 1 });
  });

  it('a match ended by a forfeit mid-round (no round_end) stops play at once', () => {
    const m = liveMatch();
    expect(m.canAct(11_000)).toBe(true);
    m.endMatch([{ slot: 0, placement: 1 }, { slot: 1, placement: 2 }]);
    expect(m.phase(11_000)).toBe('round_over');
    expect(m.canAct(11_000)).toBe(false);
    expect(m.localTick(Dir.Left, true, 11_000)).toBeNull();
    expect(m.result).toBeNull(); // no card: the announcer says MATCH OVER! until the results screen
  });

  it('an ordinary round has no match verdict', () => {
    const m = ffaMatch();
    m.endRound({ ...finalRound(1, [1, 1, 0, 0]), matchOver: false }, 5);
    expect(m.result!.verdict).toBeNull();
  });
});

describe('late events and reloads', () => {
  it('balloon_stopped parks a kicked balloon on its tile at once', () => {
    const s = buildRoundWorld(config(), roundStart());
    applyWorldEvent(s, { type: 'balloon_placed', id: 4, x: 3, y: 1, owner: 0 }, 10);
    applyWorldEvent(s, { type: 'balloon_kicked', id: 4, slot: 0, dir: Dir.Right }, 12);
    expect(s.balloons[0].slideDir).toBe(Dir.Right);
    // Last snapshot (tick 12) caught it 500 units short of tile 5, where it then stopped.
    Object.assign(s.balloons[0], { x: tileCenter(5) - 500, tx: 5 });
    const stopPx = { x: 5 * 16 + 8, y: 1 * 16 + 8 };
    expect(balloonCenter(s.balloons[0], 14, 12).x).toBeGreaterThan(stopPx.x); // glides on
    applyWorldEvent(s, { type: 'balloon_stopped', id: 4, x: 5, y: 1 }, 14);
    expect(s.balloons[0]).toMatchObject({ slideDir: Dir.None, tx: 5, ty: 1, x: tileCenter(5), y: tileCenter(1) });
    expect(balloonCenter(s.balloons[0], 14, 12)).toEqual(stopPx); // no overshoot into the blocker
  });

  it('a reload between rounds shows the round result, not the VS intro', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(config(), 0);
    expect(m.phase(5_000)).toBe('intro');
    m.endRound({ type: 'round_end', roundNo: 2, winner: 1, scores: [1, 1], summaries: [], matchOver: false }, 100);
    expect(m.phase(5_000)).toBe('result');
    expect(m.scores).toEqual([1, 1]);
    expect(m.canAct(5_000)).toBe(false);
  });
});

describe('showdown and liveness', () => {
  it('showdown: an FFA once the field is down to two dry critters', () => {
    const m = new MatchState(createSeqCounter());
    m.startMatch(ffaConfig(), 0);
    m.startRound(ffaRoundStart([0, 1, 2, 3]), 7_000);
    expect(m.round!.contenders).toBe(4);
    expect(m.showdown).toBe(false);
    m.applyEvent({ type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 1, y: 1 }, 50);
    expect(m.showdown).toBe(false);
    m.setStatus(3, FORFEITED); // the leaver no longer counts as one of the last two
    expect(m.showdown).toBe(true);
    m.applyEvent({ type: 'player_soaked', slot: 2, by: 0, cause: 'splash', x: 1, y: 1 }, 60);
    expect(m.showdown).toBe(false);
  });

  it('showdown: a round that starts with two (a duel) speeds up only in sudden death', () => {
    const m = liveMatch();
    expect(m.round!.contenders).toBe(2);
    expect(m.showdown).toBe(false);
    m.applyEvent({ type: 'tide_advance', level: 1 }, CONFIG.TIDE_START_TICKS);
    expect(m.showdown).toBe(true);
    expect(isShowdown(buildRoundWorld(config(), roundStart()), 2)).toBe(false);
  });

  it('a match is live until its own match_end arrives', () => {
    expect(matchLiveness(null, null)).toBe('none');
    expect(matchLiveness({ matchId: 'm-1' }, null)).toBe('live');
    expect(matchLiveness({ matchId: 'm-1' }, { matchId: 'm-1' })).toBe('ended');
    expect(matchLiveness({ matchId: 'm-2' }, { matchId: 'm-1' })).toBe('live');
  });
});
