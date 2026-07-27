import { describe, expect, it } from 'vitest';
import {
  CARDINALS,
  CONFIG,
  DIR_VECTORS,
  Tile,
  createRoundState,
  idx,
  makeSolidFn,
  simulateTick,
  spawnBalloon,
} from '@splash/shared';
import type { BotDifficulty, GameMode, GameState, PlayerInput } from '@splash/shared';
import { createBot } from '../src/bots/bot.js';
import { computeDangerMap } from '../src/bots/dangerMap.js';
import type { DangerMap } from '../src/bots/dangerMap.js';

interface SelfSoak {
  slot: number;
  difficulty: BotDifficulty;
  tick: number;
  /** True when every way off the tile was solid or already lethal. */
  sealed: boolean;
}

interface RoundResult {
  state: GameState;
  ticks: number;
  ended: boolean;
  selfSoaks: SelfSoak[];
  balloonsPlaced: number;
}

/** Was there anywhere at all to step, on the tick this critter went down? */
function sealedIn(state: GameState, slot: number, danger: DangerMap, tx: number, ty: number): boolean {
  const solid = makeSolidFn(state, slot);
  for (const dir of CARDINALS) {
    const [dx, dy] = DIR_VECTORS[dir];
    if (solid(tx + dx, ty + dy)) continue;
    if (!danger.isDangerous(tx + dx, ty + dy, state.tick)) return false;
  }
  return true;
}

/**
 * Headless round: poll every bot, feed the inputs to the sim, repeat until the
 * round is over. This is what the room loop does, minus the sockets.
 */
function runRound(
  seed: number,
  line: BotDifficulty[],
  mode: GameMode = 'duel',
  maxTicks = CONFIG.ROUND_MAX_TICKS,
): RoundResult {
  const state = createRoundState({
    mode,
    seed,
    slots: line.map((_, slot) => slot),
    revengeDucks: false,
  });
  const bots = line.map((difficulty, slot) => createBot(slot, difficulty, seed + slot * 7));
  for (const bot of bots) bot.reset();

  const selfSoaks: SelfSoak[] = [];
  const inputs = new Map<number, PlayerInput>();
  let balloonsPlaced = 0;

  while (state.phase !== 'ended' && state.tick < maxTicks) {
    inputs.clear();
    const nowMs = state.tick * CONFIG.TICK_MS;
    for (const bot of bots) inputs.set(bot.slot, bot.update(state, nowMs));
    // Snapshot before the tick: the balloon that does the soaking is gone after.
    const danger = computeDangerMap(state);
    const before = state.players.map((p) => ({ tx: Math.floor(p.x), ty: Math.floor(p.y) }));

    for (const event of simulateTick(state, inputs)) {
      if (event.kind === 'balloon_placed') balloonsPlaced++;
      if (event.kind !== 'player_soaked') continue;
      if (event.byTide || event.byPlayerId !== event.playerId) continue;
      const seen = before[event.playerId];
      selfSoaks.push({
        slot: event.playerId,
        difficulty: line[event.playerId],
        tick: state.tick,
        sealed: sealedIn(state, event.playerId, danger, seen.tx, seen.ty),
      });
    }
  }

  return {
    state,
    ticks: state.tick,
    ended: state.phase === 'ended',
    selfSoaks,
    balloonsPlaced,
  };
}

/** Flat arena with the border walls left in place, so geometry is predictable. */
function flatDuelState(seed: number): GameState {
  const state = createRoundState({ mode: 'duel', seed, slots: [0], revengeDucks: false });
  for (let y = 1; y < state.height - 1; y++) {
    for (let x = 1; x < state.width - 1; x++) {
      state.cells[idx(state.width, x, y)] = Tile.EMPTY;
    }
  }
  return state;
}

describe('danger map', () => {
  it('marks the cross a single balloon will wet and nothing else', () => {
    const state = flatDuelState(11);
    spawnBalloon(state, 0, 5, 5, 2, CONFIG.FUSE_TICKS, true);
    const burstAt = state.tick + CONFIG.FUSE_TICKS;
    const map = computeDangerMap(state);
    const at = (x: number, y: number): number => map.burstTick[idx(state.width, x, y)];

    expect(at(5, 5)).toBe(burstAt);
    for (const [x, y] of [
      [6, 5],
      [7, 5],
      [4, 5],
      [3, 5],
      [5, 4],
      [5, 3],
      [5, 6],
      [5, 7],
    ]) {
      expect(at(x, y)).toBe(burstAt);
    }
    // Beyond the reach, and off the arms, nothing happens until the tide.
    expect(at(8, 5)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);
    expect(at(2, 5)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);
    expect(at(6, 6)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);

    expect(map.isDangerous(5, 5, burstAt - 1)).toBe(false);
    expect(map.isDangerous(5, 5, burstAt)).toBe(true);
    expect(map.isDangerous(5, 5, burstAt + CONFIG.SPLASH_TICKS)).toBe(true);
    expect(map.isDangerous(5, 5, burstAt + CONFIG.SPLASH_TICKS + 2)).toBe(false);
  });

  it('stops arms at boulders and washes only the first sandcastle', () => {
    const state = flatDuelState(11);
    state.cells[idx(state.width, 7, 5)] = Tile.CASTLE;
    state.cells[idx(state.width, 3, 5)] = Tile.BOULDER;
    spawnBalloon(state, 0, 5, 5, 4, CONFIG.FUSE_TICKS, true);
    const burstAt = state.tick + CONFIG.FUSE_TICKS;
    const map = computeDangerMap(state);
    const at = (x: number, y: number): number => map.burstTick[idx(state.width, x, y)];

    expect(at(7, 5)).toBe(burstAt);
    // The castle swallows the rest of that arm.
    expect(at(8, 5)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);
    expect(at(4, 5)).toBe(burstAt);
    // The boulder is not even wet.
    expect(at(3, 5)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);
    expect(at(2, 5)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);
  });

  it('propagates a chain so the late balloon bursts with the early one', () => {
    const state = flatDuelState(11);
    spawnBalloon(state, 0, 5, 5, 2, 30, true);
    spawnBalloon(state, 1, 7, 5, 2, CONFIG.FUSE_TICKS, true);
    const early = state.tick + 30;
    const map = computeDangerMap(state);
    const at = (x: number, y: number): number => map.burstTick[idx(state.width, x, y)];

    expect(at(7, 5)).toBe(early);
    // The chained balloon's own arms are pulled forward with it.
    expect(at(9, 5)).toBe(early);
    expect(at(7, 3)).toBe(early);
    expect(at(7, 7)).toBe(early);
    expect(at(10, 5)).toBeGreaterThanOrEqual(CONFIG.TIDE_START_TICKS);
  });

  it('treats water and the scheduled tide as permanent danger', () => {
    const state = flatDuelState(11);
    const map = computeDangerMap(state);
    const corner = idx(state.width, 1, 1);
    expect(map.burstTick[corner]).toBe(CONFIG.TIDE_START_TICKS);
    expect(map.clearTick[corner]).toBe(Infinity);
    expect(map.isDangerous(1, 1, CONFIG.TIDE_START_TICKS - 1)).toBe(false);
    expect(map.isDangerous(1, 1, CONFIG.TIDE_START_TICKS + 10_000)).toBe(true);
  });
});

describe('bots in a live round', () => {
  const seeds = [3, 17, 91, 404, 55, 777];

  it('never soaks a hard bot on its own splash', () => {
    for (const seed of seeds) {
      // Alone in the arena there is nobody to blame: every balloon it places, it
      // has to walk away from itself.
      const solo = runRound(seed, ['hard'], 'ffa', 3000);
      expect(solo.selfSoaks).toEqual([]);
      expect(solo.state.players[0].alive).toBe(true);
      expect(solo.balloonsPlaced).toBeGreaterThan(20);
    }
  });

  it('only ever soaks a hard bot on its own splash when it was walled in', () => {
    for (const seed of seeds) {
      for (const result of [
        runRound(seed, ['hard', 'hard']),
        runRound(seed, ['hard', 'hard', 'easy', 'medium'], 'ffa'),
      ]) {
        for (const soak of result.selfSoaks) {
          if (soak.difficulty !== 'hard') continue;
          // A rival can always cork the corridor you are standing in. What a
          // hard bot must never do is stroll into its own splash with a way out.
          expect({ seed, ...soak }).toMatchObject({ sealed: true });
        }
      }
    }
  });

  it('replays a round identically from the same seed', () => {
    const digest = (result: RoundResult): string =>
      `${result.ticks}|${result.balloonsPlaced}|${result.state.winners.join(',')}|` +
      result.state.players.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.soaks}`).join(';');
    for (const seed of [3, 91]) {
      const line: BotDifficulty[] = ['hard', 'medium', 'easy', 'hard'];
      expect(digest(runRound(seed, line, 'ffa'))).toBe(digest(runRound(seed, line, 'ffa')));
    }
  });

  it('always finishes the round', () => {
    for (const seed of seeds) {
      const result = runRound(seed, ['hard', 'medium']);
      expect(result.ended).toBe(true);
      expect(result.ticks).toBeLessThanOrEqual(CONFIG.ROUND_MAX_TICKS);
    }
  });

  it('lets hard beat easy in a clear majority of decisive duels', () => {
    let hardWins = 0;
    let decisive = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // Alternate spawn corners so neither slot gets a positional advantage.
      const hardSlot = seed % 2;
      const line: BotDifficulty[] = hardSlot === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
      const result = runRound(seed * 101, line);
      expect(result.ended).toBe(true);
      // Mutual knockouts and tide stalemates are draws; they say nothing about
      // which bot is better, so only decided rounds count.
      if (result.state.winners.length !== 1) continue;
      decisive++;
      if (result.state.winners[0] === hardSlot) hardWins++;
    }
    expect(decisive).toBeGreaterThanOrEqual(8);
    expect(hardWins / decisive).toBeGreaterThan(0.7);
  });
});
