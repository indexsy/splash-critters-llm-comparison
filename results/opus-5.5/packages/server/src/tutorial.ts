// TutorialController: five scripted lessons over a sandbox MatchRunner on the hand-built tutorial
// map, the player in slot 0 and a passive easy bot in slot 1. The sandbox never ends a round;
// soaked critters respawn at their spawn after about a second. Completion awards the tutorial XP
// once, then sends match_end + a fresh profile (the sandbox keeps running until torn down).
import { randomInt, randomUUID } from 'node:crypto';
import { CONFIG, Dir, balloonAt, buildTutorialMap, idx, tileCenter } from '@splash/shared';
import type { GameEvent, MatchEndMsg, RoundState, S2C, XpAward } from '@splash/shared';
import { buildProfile, completeTutorial } from './accounts';
import type { Db } from './db';
import { MatchRunner } from './gameLoop';
import { buildPlacements, emptyTotals, tallyRound } from './match/results';
import { TUTORIAL_STEPS, TUTORIAL_TOTAL, TutorialProgress, ensurePowerUpAvailable } from './match/tutorialSteps';
import type { BotFactory, MatchParticipant, MatchSetup, MemberInfo } from './match/types';
import type { Outbox } from './net/outbox';

const TUTORIAL_PLAYER_SLOT = 0;
const TUTORIAL_BOT_SLOT = 1;
/** Soaked sandbox critters respawn this long after the soak. */
const REVIVE_TICKS = CONFIG.TICK_RATE;

export interface TutorialDeps {
  db: Db;
  outbox: Outbox;
  createBot: BotFactory;
}

function participants(member: MemberInfo): MatchParticipant[] {
  return [
    {
      slot: TUTORIAL_PLAYER_SLOT,
      playerId: member.playerId,
      name: member.name,
      tag: member.tag,
      animal: member.animal,
      hat: member.hat,
      level: member.level,
    },
    {
      slot: TUTORIAL_BOT_SLOT,
      playerId: null,
      difficulty: 'easy',
      passive: true,
      name: 'Bot Bubbles',
      tag: '',
      animal: member.animal === 'duck' ? 'frog' : 'duck',
      hat: 'none',
      level: 1,
    },
  ];
}

export class TutorialController {
  readonly runner: MatchRunner;
  private readonly progress = new TutorialProgress(TUTORIAL_PLAYER_SLOT, TUTORIAL_BOT_SLOT);
  private readonly spawns = buildTutorialMap().spawns;
  private lastStep: S2C | null = null;
  private finishedAt = 0;

  constructor(
    private readonly member: MemberInfo,
    roomCode: string,
    private readonly deps: TutorialDeps,
  ) {
    const map = buildTutorialMap();
    const setup: MatchSetup = {
      matchId: `tutorial-${randomUUID()}`,
      roomCode,
      kind: 'tutorial',
      mode: 'duel',
      size: 2,
      w: map.w,
      h: map.h,
      roundsToWin: 1,
      theme: 'backyard',
      participants: participants(member),
      seed: randomInt(2 ** 31),
    };
    this.runner = new MatchRunner(setup, deps, {
      matchIntroMs: 0,
      hooks: {
        buildMap: () => buildTutorialMap(),
        afterTick: (state, events, now) => this.afterTick(state, events, now),
        onResync: () => this.resendStep(),
      },
    });
  }

  /** Server time the tutorial was completed, 0 while in progress. */
  get completedAt(): number {
    return this.finishedAt;
  }

  get step(): number {
    return Math.min(this.progress.step, TUTORIAL_TOTAL);
  }

  start(now: number): void {
    this.runner.start(now);
    this.sendStep();
  }

  private send(msg: S2C): void {
    this.deps.outbox.send(this.member.playerId, msg);
  }

  private sendStep(): void {
    const step = this.progress.step;
    const lesson = TUTORIAL_STEPS[step - 1];
    this.lastStep = { type: 'tutorial_step', step, total: TUTORIAL_TOTAL, title: lesson.title, text: lesson.text, done: false };
    this.send(this.lastStep);
  }

  private resendStep(): void {
    if (this.lastStep) this.send(this.lastStep);
  }

  private afterTick(state: RoundState, events: GameEvent[], now: number): void {
    if (!this.progress.complete && this.progress.observe(state, events)) {
      if (this.progress.complete) this.complete(state, now);
      else this.sendStep();
    }
    if (!this.progress.complete && this.progress.step === 3) ensurePowerUpAvailable(state, events, TUTORIAL_PLAYER_SLOT);
    this.reviveSoaked(state);
  }

  /** Sandbox respawn: a soaked critter reappears at its spawn once that tile is dry and free. */
  private reviveSoaked(state: RoundState): void {
    for (const p of state.players) {
      if (!p.present || p.alive || p.soakedTick < 0 || state.tick - p.soakedTick < REVIVE_TICKS) continue;
      const spawn = this.spawns.find((sp) => sp.slot === p.slot)!;
      if (state.splashUntil[idx(state.w, spawn.tx, spawn.ty)] > state.tick || balloonAt(state, spawn.tx, spawn.ty)) continue;
      p.alive = true;
      p.x = tileCenter(spawn.tx);
      p.y = tileCenter(spawn.ty);
      p.facing = Dir.Down;
      p.moving = false;
      p.soakedTick = -1;
      p.soakedBy = -1;
      p.duckPos = -1;
      if (p.slot === TUTORIAL_BOT_SLOT) this.runner.resetBrain(p.slot);
    }
  }

  private complete(state: RoundState, now: number): void {
    this.finishedAt = now;
    const award = this.awardXp();
    const xpText = award ? `You earned ${award.earned} XP!` : 'You already earned the tutorial XP.';
    this.lastStep = {
      type: 'tutorial_step',
      step: TUTORIAL_TOTAL,
      total: TUTORIAL_TOTAL,
      title: 'Tutorial complete!',
      text: `${xpText} You are ready to splash for real.`,
      done: true,
    };
    this.send(this.lastStep);
    this.send(this.matchEnd(state, award));
    try {
      this.send({ type: 'profile', profile: buildProfile(this.deps.db, this.member.playerId) });
    } catch (err) {
      console.error('[tutorial] profile refresh failed', err);
    }
  }

  private awardXp(): XpAward | null {
    try {
      return completeTutorial(this.deps.db, this.member.playerId);
    } catch (err) {
      console.error('[tutorial] could not record completion', err);
      return null;
    }
  }

  private matchEnd(state: RoundState, award: XpAward | null): MatchEndMsg {
    const totals = emptyTotals(state.players.length);
    tallyRound(totals, state);
    const seated = [this.runner.participant(TUTORIAL_PLAYER_SLOT), this.runner.participant(TUTORIAL_BOT_SLOT)];
    const scores = seated.map((p) => (p?.slot === TUTORIAL_PLAYER_SLOT ? 1 : 0));
    return {
      type: 'match_end',
      matchId: this.runner.setup.matchId,
      mode: this.runner.setup.mode,
      ranked: false,
      practice: false,
      tutorial: true,
      placements: buildPlacements(seated, totals, scores, new Set()),
      ratingDeltas: null,
      xp: award ? [award] : [],
      funStats: [],
      canRematch: false,
    };
  }
}
