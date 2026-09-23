import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMap } from '../src/map';
import { hashSeed, mulberry32, randInt } from '../src/rng';
import { simulateTick, stateHash } from '../src/sim';
import { cloneState, createRoundState, makeRules } from '../src/state';
import type { DirCode, GameEvent, PlayerInput, RoundState } from '../src/types';

/** Stateless scripted inputs: a function of (seed, tick, slot) only, so replays line up. */
function scriptedInputs(seed: number, tick: number, players: number): PlayerInput[] {
  return Array.from({ length: players }, (_, slot) => {
    const dir = randInt(mulberry32(hashSeed(seed, slot, Math.floor(tick / 9))), 5) as DirCode;
    const balloon = mulberry32(hashSeed(seed, slot, tick, 7))() < 0.05;
    return { seq: tick, dir, balloon };
  });
}

function newMatchState(seed: number): RoundState {
  // Sandbox keeps the round alive for the whole script, so ducks and the tide get exercised too.
  const rules = { ...makeRules({ ranked: false }), tideStartTick: 400, sandbox: true };
  const s = createRoundState(generateMap('ffa', seed), [true, true, true, true], rules);
  for (const p of s.players) p.canKick = true;
  return s;
}

function run(s: RoundState, seed: number, fromTick: number, toTick: number) {
  const hashes: number[] = [];
  const events: GameEvent[][] = [];
  for (let t = fromTick; t < toTick; t++) {
    events.push(simulateTick(s, scriptedInputs(seed, t, 4)));
    hashes.push(stateHash(s));
  }
  return { hashes, events };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('determinism', () => {
  it('two runs with identical inputs produce identical hashes and events every tick', () => {
    const a = run(newMatchState(31337), 5, 0, 1200);
    const b = run(newMatchState(31337), 5, 0, 1200);
    expect(b.hashes).toEqual(a.hashes);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    const all = a.events.flat().map((e) => e.type);
    const exercised = ['balloon_placed', 'balloon_burst', 'castle_washed', 'player_soaked', 'tide_advance', 'revenge_lob'];
    for (const type of exercised) {
      expect(all).toContain(type);
    }
  });

  it('never consults Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used inside the simulation');
    });
    expect(() => run(newMatchState(8), 9, 0, 600)).not.toThrow();
  });

  it('different inputs diverge', () => {
    const a = run(newMatchState(1), 1, 0, 200);
    const b = run(newMatchState(1), 2, 0, 200);
    expect(b.hashes[199]).not.toBe(a.hashes[199]);
  });

  it('cloneState is independent and replays identically', () => {
    const s = newMatchState(4242);
    run(s, 3, 0, 300);
    const copy = cloneState(s);
    expect(stateHash(copy)).toBe(stateHash(s));
    const original = run(s, 3, 300, 700);
    const cloned = run(copy, 3, 300, 700);
    expect(cloned.hashes).toEqual(original.hashes);

    const before = stateHash(s);
    const snapshot = JSON.stringify({ players: s.players, balloons: s.balloons, splashes: s.splashes, rules: s.rules });
    const other = cloneState(s);
    other.tiles[0] = 0;
    other.hidden.fill(0);
    other.splashUntil[5] = 99;
    other.players[0].x += 1;
    other.players[1].stats.soaks += 1;
    for (const b of other.balloons) b.burstTick += 5;
    for (const sp of other.splashes) sp.arms[0] += 1;
    other.rules.tide = !other.rules.tide;
    expect(stateHash(s)).toBe(before);
    expect(JSON.stringify({ players: s.players, balloons: s.balloons, splashes: s.splashes, rules: s.rules })).toBe(snapshot);
    expect(stateHash(other)).not.toBe(before);
  });

  it('stateHash reacts to every kind of field', () => {
    const base = newMatchState(77);
    run(base, 4, 0, 250);
    const h = stateHash(base);
    const mutations: ((s: RoundState) => void)[] = [
      (s) => (s.tick += 1),
      (s) => (s.tiles[20] ^= 1),
      (s) => (s.hidden[20] ^= 1),
      (s) => (s.items[20] ^= 1),
      (s) => (s.splashOwner[20] = 3),
      (s) => (s.players[2].y -= 1),
      (s) => (s.players[3].canKick = !s.players[3].canKick),
      (s) => (s.players[0].stats.selfSoaked = !s.players[0].stats.selfSoaked),
      (s) => (s.nextId += 1),
      (s) => (s.overTick = s.tick),
      (s) => (s.rules.sandbox = !s.rules.sandbox),
    ];
    for (const mutate of mutations) {
      const c = cloneState(base);
      mutate(c);
      expect(stateHash(c)).not.toBe(h);
    }
  });
});
