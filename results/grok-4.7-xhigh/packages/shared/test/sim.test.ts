import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createBotMemory, botAct } from '../src/bot.js';
import { generateMap } from '../src/map.js';
import { mulberry32 } from '../src/rng.js';
import { blankState, createGameState, hashState, makePlayer, simulateTick, tileAt } from '../src/sim.js';
import { Dir, Tile, type Balloon, type GameState } from '../src/types.js';

function balloon(partial: Partial<Balloon> & { id: string; x: number; y: number }): Balloon {
  return {
    ownerId: 'p',
    fuse: 1,
    range: 2,
    sliding: false,
    slideDir: Dir.None,
    slideAcc: 0,
    born: 0,
    revenge: false,
    ...partial,
  };
}

describe('splashes', () => {
  it('bursts a 3-balloon chain in one tick', () => {
    const state = blankState(11, 11);
    state.balloons = [
      balloon({ id: 'a', x: 3, y: 5, fuse: 1, range: 3, ownerId: 'p1' }),
      balloon({ id: 'b', x: 5, y: 5, fuse: 80, range: 3, ownerId: 'p1' }),
      balloon({ id: 'c', x: 5, y: 7, fuse: 80, range: 3, ownerId: 'p2' }),
    ];
    simulateTick(state, {});
    expect(state.balloons).toHaveLength(0);
    const chain = state.events.filter((e) => e.type === 'chain_burst');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ type: 'chain_burst', count: 3 });
    expect(state.splashes.length).toBeGreaterThan(0);
  });

  it('stops a splash at the first sandcastle', () => {
    const state = blankState(11, 11);
    state.tiles[5 * 11 + 5] = Tile.Sandcastle;
    state.balloons = [balloon({ id: 'a', x: 2, y: 5, fuse: 1, range: 6 })];
    simulateTick(state, {});
    expect(tileAt(state, 5, 5)).toBe(Tile.Empty);
    expect(state.splashes.some((s) => s.x === 5 && s.y === 5)).toBe(true);
    expect(state.splashes.some((s) => s.x === 4 && s.y === 5)).toBe(true);
    expect(state.splashes.some((s) => s.x === 6 && s.y === 5)).toBe(false);
    expect(state.events.some((e) => e.type === 'castle_washed' && e.x === 5 && e.y === 5)).toBe(true);
  });

  it('does not splash through a boulder', () => {
    const state = blankState(11, 11);
    state.tiles[5 * 11 + 4] = Tile.Boulder;
    state.balloons = [balloon({ id: 'a', x: 2, y: 5, fuse: 1, range: 6 })];
    simulateTick(state, {});
    expect(state.splashes.some((s) => s.x === 3 && s.y === 5)).toBe(true);
    expect(state.splashes.some((s) => s.x === 4 && s.y === 5)).toBe(false);
    expect(state.splashes.some((s) => s.x === 5 && s.y === 5)).toBe(false);
  });

  it('soaks a player standing on a splash and not one tile past a castle', () => {
    const state = blankState(11, 11);
    state.tiles[5 * 11 + 5] = Tile.Sandcastle;
    state.players = [
      makePlayer({ id: 'wet', x: 3.5, y: 5.5, slot: 0 }),
      makePlayer({ id: 'dry', x: 6.5, y: 5.5, slot: 1 }),
    ];
    state.balloons = [balloon({ id: 'a', x: 2, y: 5, fuse: 1, range: 6, ownerId: 'wet' })];
    simulateTick(state, {});
    expect(state.players.find((p) => p.id === 'wet')!.alive).toBe(false);
    expect(state.players.find((p) => p.id === 'dry')!.alive).toBe(true);
  });

  it('lets the owner walk off a fresh balloon', () => {
    const state = blankState(9, 9);
    state.players = [makePlayer({ id: 'p', x: 2.5, y: 2.5, balloonCount: 1, speed: 4 })];
    simulateTick(state, { p: { seq: 1, tick: state.tick, dir: Dir.None, balloon: true } });
    expect(state.balloons).toHaveLength(1);
    expect(state.balloons[0].id).toBe('p:1');
    for (let i = 0; i < 10; i++) {
      simulateTick(state, { p: { seq: 2 + i, tick: state.tick, dir: Dir.Right, balloon: false } });
    }
    expect(state.players[0].alive).toBe(true);
    expect(Math.floor(state.players[0].x)).toBeGreaterThan(2);
  });
});

describe('map generation', () => {
  it('is identical for the same seed, including hidden power-ups', () => {
    const a = generateMap({ mode: 'ffa', seed: 123456 });
    const b = generateMap({ mode: 'ffa', seed: 123456 });
    expect(a.tiles).toEqual(b.tiles);
    expect(a.hidden).toEqual(b.hidden);
    expect(a.width).toBe(CONFIG.FFA_W);
    expect(a.height).toBe(CONFIG.FFA_H);
    const duel = generateMap({ mode: 'duel', seed: 42 });
    expect(duel.width).toBe(13);
    expect(duel.height).toBe(11);
    expect(duel.tiles[2 * duel.width + 2]).toBe(Tile.Boulder);
    for (const s of duel.spawns) {
      expect(duel.tiles[s.y * duel.width + s.x]).not.toBe(Tile.Sandcastle);
    }
  });

  it('rng is deterministic', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(mulberry32(100)()).not.toBe(seqA[0]);
  });
});

describe('bots', () => {
  it('hard reliably beats easy and neither soaks itself', () => {
    let hardWins = 0;
    let finished = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const result = playDuel(seed);
      if (!result) continue;
      finished++;
      if (result.winner === 'hard') hardWins++;
      expect(result.selfSoaks).toBe(0);
    }
    expect(finished).toBeGreaterThanOrEqual(5);
    expect(hardWins).toBeGreaterThanOrEqual(4);
  });
});

function playDuel(seed: number): { winner: string | null; selfSoaks: number } | null {
  const state = createGameState({
    mode: 'duel',
    seed: seed * 997,
    theme: 'beach',
    revenge: false,
    roundsToWin: 1,
    players: [
      { id: 'hard', name: 'Hard', slot: 0, animal: 'otter', hat: null, isBot: true, difficulty: 'hard' },
      { id: 'easy', name: 'Easy', slot: 1, animal: 'frog', hat: null, isBot: true, difficulty: 'easy' },
    ],
  });
  const mem = {
    hard: createBotMemory(seed * 3 + 1),
    easy: createBotMemory(seed * 3 + 2),
  };
  let selfSoaks = 0;
  for (let n = 0; n < 7000 && !state.over; n++) {
    const inputs = {
      hard: botAct(state, 'hard', mem.hard),
      easy: botAct(state, 'easy', mem.easy),
    };
    inputs.hard.seq = n + 1;
    inputs.easy.seq = n + 1;
    simulateTick(state, inputs);
    for (const e of state.events) {
      if (e.type === 'player_soaked' && e.by === e.playerId) selfSoaks++;
    }
  }
  if (!state.over) return null;
  return { winner: state.winnerId, selfSoaks };
}

describe('determinism', () => {
  it('replays the same inputs to the same hash', () => {
    const mk = (): GameState =>
      createGameState({
        mode: 'ffa',
        seed: 77,
        theme: 'pool',
        revenge: false,
        roundsToWin: 3,
        players: [
          { id: 'a', name: 'A', slot: 0, animal: 'duck', hat: null, isBot: true, difficulty: 'hard' },
          { id: 'b', name: 'B', slot: 1, animal: 'cat', hat: 'bucket', isBot: true, difficulty: 'medium' },
          { id: 'c', name: 'C', slot: 2, animal: 'turtle', hat: null, isBot: true, difficulty: 'easy' },
          { id: 'd', name: 'D', slot: 3, animal: 'frog', hat: null, isBot: true, difficulty: 'hard' },
        ],
      });
    const a = mk();
    const b = mk();
    const brains = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, mem: createBotMemory(100 + i) }));
    for (let n = 0; n < 400; n++) {
      const inputs: Record<string, ReturnType<typeof botAct>> = {};
      for (const brain of brains) {
        const inp = botAct(a, brain.id, brain.mem);
        inp.seq = n + 1;
        inputs[brain.id] = inp;
      }
      simulateTick(a, inputs);
      simulateTick(b, inputs);
      expect(hashState(a)).toBe(hashState(b));
    }
  });
});
