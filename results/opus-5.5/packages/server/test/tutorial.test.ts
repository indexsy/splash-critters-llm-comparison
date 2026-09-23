import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG,
  Dir,
  PowerUp,
  Tile,
  buildTutorialMap,
  createRoundState,
  idx,
  makeRules,
  tileCenter,
  type DirCode,
  type GameEvent,
  type MsgOf,
  type RoundState,
  type S2C,
  type S2CType,
} from '@splash/shared';
import { buildProfile, loginOrCreate } from '../src/accounts';
import { openDb, type Db } from '../src/db';
import { TutorialProgress, ensurePowerUpAvailable } from '../src/match/tutorialSteps';
import type { BotFactory, MemberInfo } from '../src/match/types';
import type { Outbox } from '../src/net/outbox';
import { TutorialController } from '../src/tutorial';

class FakeOutbox implements Outbox {
  readonly sent = new Map<string, S2C[]>();
  send(playerId: string, msg: S2C): void {
    const list = this.sent.get(playerId) ?? [];
    list.push(msg);
    this.sent.set(playerId, list);
  }
  rtt(): number {
    return 20;
  }
  ofType<T extends S2CType>(playerId: string, type: T): MsgOf<S2C, T>[] {
    return (this.sent.get(playerId) ?? []).filter((m): m is MsgOf<S2C, T> => m.type === type);
  }
}

const openDbs: Db[] = [];
afterEach(() => openDbs.splice(0).forEach((db) => db.close()));

function sandboxState(): RoundState {
  return createRoundState(buildTutorialMap(), [true, true], makeRules({ ranked: false, tutorial: true }));
}

function moveTo(state: RoundState, slot: number, tx: number, ty: number): void {
  state.players[slot].x = tileCenter(tx);
  state.players[slot].y = tileCenter(ty);
}

describe('TutorialProgress', () => {
  it('counts walked tiles for lesson 1 and needs a survived castle burst for lesson 2', () => {
    const state = sandboxState();
    const progress = new TutorialProgress(0, 1);
    progress.observe(state, []);
    for (const ty of [3, 2, 1]) {
      moveTo(state, 0, 1, ty);
      progress.observe(state, []);
    }
    expect(progress.step).toBe(2);

    const washed: GameEvent = { type: 'castle_washed', x: 2, y: 3, by: 0 };
    const soaked: GameEvent = { type: 'player_soaked', slot: 0, by: 0, cause: 'splash', x: 1, y: 3 };
    progress.observe(state, [washed, soaked]);
    state.tick += CONFIG.SPLASH_TICKS;
    progress.observe(state, []);
    expect(progress.step).toBe(2);

    progress.observe(state, [washed]);
    state.tick += CONFIG.SPLASH_TICKS;
    expect(progress.observe(state, [])).toBe(true);
    expect(progress.step).toBe(3);
  });

  it('latches power-up and chain lessons learned early; the bot soak only counts in lesson 5', () => {
    const state = sandboxState();
    const progress = new TutorialProgress(0, 1);
    const botSoak: GameEvent = { type: 'player_soaked', slot: 1, by: 0, cause: 'splash', x: 9, y: 4 };
    progress.observe(state, [
      { type: 'powerup_collected', x: 2, y: 3, kind: PowerUp.Balloon, slot: 0 },
      { type: 'chain_burst', count: 2, x: 3, y: 3, owner: 0, chainId: 1 },
      botSoak,
    ]);
    for (const ty of [3, 2, 1]) {
      moveTo(state, 0, 1, ty);
      progress.observe(state, []);
    }
    progress.observe(state, [{ type: 'castle_washed', x: 2, y: 3, by: 0 }]);
    state.tick += CONFIG.SPLASH_TICKS;
    progress.observe(state, []);
    expect(progress.step).toBe(5);
    expect(progress.complete).toBe(false);
    progress.observe(state, [{ ...botSoak, by: -1 }]);
    expect(progress.complete).toBe(false);
    progress.observe(state, [botSoak]);
    expect(progress.complete).toBe(true);
  });

  it('re-supplies an Extra Balloon near the player when no power-up is left anywhere', () => {
    const state = sandboxState();
    state.hidden.fill(PowerUp.None);
    moveTo(state, 0, 1, 1);
    const events: GameEvent[] = [];
    ensurePowerUpAvailable(state, events, 0);
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<GameEvent, { type: 'powerup_revealed' }>;
    expect(ev.kind).toBe(PowerUp.Balloon);
    expect(state.items[idx(state.w, ev.x, ev.y)]).toBe(PowerUp.Balloon);
    expect(state.tiles[idx(state.w, ev.x, ev.y)]).toBe(Tile.Floor);
    ensurePowerUpAvailable(state, events, 0);
    expect(events).toHaveLength(1);
  });
});

/** A passive bot that stands still on its spawn (records how it was created). */
function stationaryBots(created: { passive: boolean; difficulty: string }[]): BotFactory {
  return (slot, difficulty, _seed, opts) => {
    created.push({ passive: opts?.passive === true, difficulty });
    return { slot, difficulty, nextInput: () => ({ seq: 0, dir: Dir.None, balloon: false }), reset: () => undefined };
  };
}

function playthrough() {
  const db = openDb(':memory:');
  openDbs.push(db);
  const { player } = loginOrCreate(db);
  const member: MemberInfo = { playerId: player.id, name: 'Learner', tag: player.tag, animal: 'frog', hat: 'none', level: 1, hasNickname: false };
  const outbox = new FakeOutbox();
  const created: { passive: boolean; difficulty: string }[] = [];
  const tutorial = new TutorialController(member, 'TUTOR1', { db, outbox, createBot: stationaryBots(created) });
  const runner = tutorial.runner;
  let now = 2_000_000;
  let seq = 0;
  tutorial.start(now);

  const me = () => runner.state!.players[0];
  const step = (dir: DirCode = Dir.None, balloon = false) => {
    now += CONFIG.TICK_MS;
    if (runner.phase === 'live') runner.pushInput(0, { seq: ++seq, dir, balloon }, now);
    runner.tick(now);
  };
  const wait = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  const walkTo = (tx: number, ty: number) => {
    for (let guard = 0; guard < 200; guard++) {
      const dx = tileCenter(tx) - me().x;
      const dy = tileCenter(ty) - me().y;
      if (Math.abs(dx) <= 200 && Math.abs(dy) <= 200) return;
      step(Math.abs(dx) > 200 ? (dx > 0 ? Dir.Right : Dir.Left) : dy > 0 ? Dir.Down : Dir.Up);
    }
    throw new Error(`walkTo(${tx},${ty}) stuck at ${me().x},${me().y}`);
  };
  const path = (...tiles: [number, number][]) => tiles.forEach(([x, y]) => walkTo(x, y));
  const drop = () => step(Dir.None, true);
  const steps = () => outbox.ofType(player.id, 'tutorial_step');
  return { db, player, outbox, created, tutorial, runner, now: () => now, me, wait, path, drop, steps };
}

describe('TutorialController', () => {
  it('can be completed lesson by lesson on the real tutorial map', () => {
    const t = playthrough();
    expect(t.created).toEqual([{ passive: true, difficulty: 'easy' }]);
    const start = t.outbox.ofType(t.player.id, 'match_start')[0].config;
    expect(start).toMatchObject({ tutorial: true, w: 11, h: 9, yourSlot: 0 });
    expect(start.rules.sandbox).toBe(true);
    expect(t.outbox.ofType(t.player.id, 'round_start')).toHaveLength(1);
    expect(t.steps()[0]).toMatchObject({ step: 1, total: 5, done: false });

    t.wait(Math.ceil(CONFIG.ROUND_INTRO_MS / CONFIG.TICK_MS) + 2);
    expect(t.runner.phase).toBe('live');

    // 1. Move: walk three tiles up the left column.
    t.path([1, 3], [1, 2], [1, 1]);
    expect(t.tutorial.step).toBe(2);

    // 2. Balloon next to the castle at (2,3), hide at (2,1) until the splash is gone.
    t.path([1, 3]);
    t.drop();
    t.path([1, 1], [2, 1]);
    t.wait(CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS);
    expect(t.me().alive).toBe(true);
    expect(t.tutorial.step).toBe(3);

    // 3. The washed castle revealed an Extra Balloon: collect it.
    t.path([1, 1], [1, 3], [2, 3]);
    expect(t.me().maxBalloons).toBe(2);
    expect(t.tutorial.step).toBe(4);

    // 4. Chain: balloons on (3,3) and (5,3), shelter at (7,2).
    t.path([3, 3]);
    t.drop();
    t.path([5, 3]);
    t.drop();
    t.path([7, 3], [7, 2]);
    t.wait(CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS);
    expect(t.me().alive).toBe(true);
    expect(t.tutorial.step).toBe(5);

    // 5. Soak the bot standing on its spawn (9,4) from (9,3), shelter at (7,2).
    t.path([7, 3], [9, 3]);
    t.drop();
    t.path([8, 3], [7, 3], [7, 2]);
    t.wait(CONFIG.FUSE_TICKS);

    const last = t.steps().at(-1)!;
    expect(last).toMatchObject({ done: true, title: 'Tutorial complete!' });
    expect(last.text).toContain(`${CONFIG.XP.TUTORIAL} XP`);
    const end = t.outbox.ofType(t.player.id, 'match_end')[0];
    expect(end).toMatchObject({ tutorial: true, ratingDeltas: null, funStats: [], canRematch: false });
    expect(end.xp).toHaveLength(1);
    expect(end.xp[0].earned).toBe(CONFIG.XP.TUTORIAL);
    expect(end.placements.map((p) => [p.slot, p.placement, p.isBot])).toEqual([
      [0, 1, false],
      [1, 2, true],
    ]);
    expect(t.outbox.ofType(t.player.id, 'profile').at(-1)!.profile.tutorialDone).toBe(true);
    expect(t.tutorial.completedAt).toBeGreaterThan(0);
    expect(t.tutorial.completedAt).toBeLessThanOrEqual(t.now());
    expect(buildProfile(t.db, t.player.id).xp).toBe(CONFIG.XP.TUTORIAL);

    // The sandbox keeps running after completion (and the soaked bot respawns).
    t.wait(CONFIG.TICK_RATE + 5);
    expect(t.runner.state!.players[1].alive).toBe(true);
    expect(t.outbox.ofType(t.player.id, 'match_end')).toHaveLength(1);
  });

  it('respawns a self-soaked player at the spawn after about a second', () => {
    const t = playthrough();
    t.wait(Math.ceil(CONFIG.ROUND_INTRO_MS / CONFIG.TICK_MS) + 2);
    t.path([1, 3]);
    t.drop();
    t.wait(CONFIG.FUSE_TICKS);
    expect(t.me().alive).toBe(false);
    t.wait(CONFIG.TICK_RATE + 2);
    expect(t.me().alive).toBe(true);
    expect([t.me().x, t.me().y]).toEqual([tileCenter(1), tileCenter(4)]);
    expect(t.runner.state!.over).toBe(false);
  });

  it('resends the current lesson when the player re-attaches', () => {
    const t = playthrough();
    t.wait(10);
    const before = t.steps().length;
    expect(t.runner.resync(t.player.id)).toBe(true);
    expect(t.steps()).toHaveLength(before + 1);
    expect(t.steps().at(-1)).toMatchObject({ step: 1, done: false });
  });
});
