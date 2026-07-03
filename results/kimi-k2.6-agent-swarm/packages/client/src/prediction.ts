import { CONFIG } from '@shared/config.js';
import {
  simulateTick,
  createRoundState,
  getInitialPlayerState,
  type RoundState,
  type SimInput,
} from '@shared/sim.js';
import type {
  PlayerState,
  Snapshot,
  InputFrame,
  GameConfig,
  Tile,
  Animal,
  Hat,
} from '@shared/types.js';

function cloneRoundState(state: RoundState): RoundState {
  return {
    ...state,
    map: {
      ...state.map,
      grid: state.map.grid.map((row) => [...row]),
      hiddenPowerUps: new Map(state.map.hiddenPowerUps),
    },
    players: state.players.map((p) => ({ ...p })),
    balloons: state.balloons.map((b) => ({ ...b })),
    splashes: state.splashes.map((s) => ({ ...s })),
    exposedPowerUps: new Map(state.exposedPowerUps),
    events: [],
  };
}

export class Predictor {
  private localPlayerId: string;
  private currentTick = 0;
  private localState: RoundState | null = null;
  private inputBuffer: { tick: number; input: InputFrame }[] = [];
  private stateHistory: Map<number, RoundState> = new Map();
  private snapshotHistory: Snapshot[] = [];
  private serverTickEstimate = 0;
  private reconciliationAlpha = 0.0;

  constructor(localPlayerId: string) {
    this.localPlayerId = localPlayerId;
  }

  startRound(
    config: GameConfig,
    roundNo: number,
    _mapSeed: number,
    _castleGrid: Tile[][],
    _theme: string,
    spawnPoints: { x: number; y: number }[],
    players: {
      playerId: string;
      nickname: string;
      animal: Animal;
      hat: Hat;
    }[]
  ): void {
    const playerStates = players.map((p, i) =>
      getInitialPlayerState(
        p.playerId,
        p.nickname,
        p.animal,
        spawnPoints[i % spawnPoints.length]
      )
    );

    this.localState = createRoundState(config, _mapSeed, roundNo, playerStates);
    this.currentTick = 0;
    this.inputBuffer = [];
    this.stateHistory = new Map();
    this.snapshotHistory = [];
    this.reconciliationAlpha = 0.0;
  }

  applyInput(input: InputFrame): void {
    if (!this.localState) return;
    this.currentTick++;
    const tick = this.currentTick;

    this.inputBuffer.push({ tick, input });
    if (this.inputBuffer.length > 30) this.inputBuffer.shift();

    const simInput: SimInput = {
      tick,
      playerInputs: new Map([[this.localPlayerId, input]]),
    };
    simulateTick(this.localState, simInput, CONFIG);

    this.stateHistory.set(tick, cloneRoundState(this.localState));
    if (this.stateHistory.size > 60) {
      const oldest = Math.min(...this.stateHistory.keys());
      this.stateHistory.delete(oldest);
    }
  }

  reconcile(snapshot: Snapshot): void {
    this.serverTickEstimate = snapshot.tick;
    this.snapshotHistory.push(snapshot);
    if (this.snapshotHistory.length > 30) this.snapshotHistory.shift();

    if (!this.localState) return;

    const stateAtTick = this.stateHistory.get(snapshot.tick);
    if (!stateAtTick) {
      // Snapshot too old; apply directly to current state
      this.applySnapshotToState(snapshot, this.localState);
      return;
    }

    const predictedPlayer = stateAtTick.players.find(
      (p) => p.playerId === this.localPlayerId
    );
    const serverPlayer = snapshot.players.find(
      (p) => p.playerId === this.localPlayerId
    );

    const mismatch =
      predictedPlayer &&
      serverPlayer &&
      (Math.abs(predictedPlayer.x - serverPlayer.x) > 0.1 ||
        Math.abs(predictedPlayer.y - serverPlayer.y) > 0.1);

    if (!mismatch) {
      // No mismatch; just sync dynamic state from snapshot
      this.applySnapshotToState(snapshot, this.localState);
      return;
    }

    // Rewind and replay from the snapshot tick
    const replayState = cloneRoundState(stateAtTick);
    this.applySnapshotToState(snapshot, replayState);

    const subsequentInputs = this.inputBuffer
      .filter((i) => i.tick > snapshot.tick)
      .sort((a, b) => a.tick - b.tick);

    for (const { tick, input } of subsequentInputs) {
      const simInput: SimInput = {
        tick,
        playerInputs: new Map([[this.localPlayerId, input]]),
      };
      simulateTick(replayState, simInput, CONFIG);
      this.stateHistory.set(tick, cloneRoundState(replayState));
    }

    // Smooth reconciliation: lerp current state toward replayed state over a few frames
    this.reconciliationAlpha = 0.25;
    this.lerpToward(this.localState, replayState);
  }

  private applySnapshotToState(snapshot: Snapshot, state: RoundState): void {
    state.players = snapshot.players.map((p) => ({ ...p }));
    state.balloons = snapshot.balloons.map((b) => ({ ...b }));
    state.splashes = snapshot.splashes.map((s) => ({ ...s }));
    state.tideRing = snapshot.tideRing;
    state.events = [...snapshot.events];
    state.exposedPowerUps = new Map();
    for (const pu of snapshot.powerUps) {
      state.exposedPowerUps.set(`${pu.x},${pu.y}`, pu.type);
    }
  }

  private lerpToward(state: RoundState, target: RoundState): void {
    for (const player of state.players) {
      const targetPlayer = target.players.find(
        (p) => p.playerId === player.playerId
      );
      if (!targetPlayer) continue;
      player.x += (targetPlayer.x - player.x) * this.reconciliationAlpha;
      player.y += (targetPlayer.y - player.y) * this.reconciliationAlpha;
    }
    for (const balloon of state.balloons) {
      const targetBalloon = target.balloons.find((b) => b.id === balloon.id);
      if (!targetBalloon) continue;
      balloon.x += (targetBalloon.x - balloon.x) * this.reconciliationAlpha;
      balloon.y += (targetBalloon.y - balloon.y) * this.reconciliationAlpha;
    }
  }

  getLocalState(): RoundState | null {
    return this.localState;
  }

  getInterpolatedPlayer(playerId: string): PlayerState | null {
    const interpDelayTicks = Math.floor(
      (CONFIG.INTERP_DELAY_MS * CONFIG.TICK_RATE) / 1000
    );
    const targetTick = this.serverTickEstimate - interpDelayTicks;

    const snapshots = this.snapshotHistory;
    if (snapshots.length === 0) return null;
    if (snapshots.length === 1) {
      return snapshots[0].players.find((p) => p.playerId === playerId) ?? null;
    }

    let prev = snapshots[0];
    let next = snapshots[snapshots.length - 1];
    for (let i = 0; i < snapshots.length - 1; i++) {
      if (
        snapshots[i].tick <= targetTick &&
        snapshots[i + 1].tick > targetTick
      ) {
        prev = snapshots[i];
        next = snapshots[i + 1];
        break;
      }
    }

    if (targetTick <= prev.tick) {
      return prev.players.find((p) => p.playerId === playerId) ?? null;
    }
    if (targetTick >= next.tick) {
      return next.players.find((p) => p.playerId === playerId) ?? null;
    }

    const t = (targetTick - prev.tick) / (next.tick - prev.tick);
    const prevPlayer = prev.players.find((p) => p.playerId === playerId);
    const nextPlayer = next.players.find((p) => p.playerId === playerId);
    if (!prevPlayer || !nextPlayer) return null;

    return {
      ...prevPlayer,
      x: prevPlayer.x + (nextPlayer.x - prevPlayer.x) * t,
      y: prevPlayer.y + (nextPlayer.y - prevPlayer.y) * t,
      alive: nextPlayer.alive,
      direction: nextPlayer.direction,
      speed: nextPlayer.speed,
      balloonCount: nextPlayer.balloonCount,
      splashRange: nextPlayer.splashRange,
      hasBoots: nextPlayer.hasBoots,
      balloonsAlive: nextPlayer.balloonsAlive,
      emoteCooldown: nextPlayer.emoteCooldown,
      soakedAt: nextPlayer.soakedAt,
      soaks: nextPlayer.soaks,
      castlesWashed: nextPlayer.castlesWashed,
      chainBursts: nextPlayer.chainBursts,
      revengeDuckCooldown: nextPlayer.revengeDuckCooldown,
      revengeDuckReady: nextPlayer.revengeDuckReady,
      score: nextPlayer.score,
      inputDir: nextPlayer.inputDir,
    };
  }

  getBalloonFusePercent(balloonId: string): number {
    const balloon = this.localState?.balloons.find((b) => b.id === balloonId);
    if (!balloon) return 0;
    return balloon.fuseTicks / CONFIG.BALLOON_FUSE_TICKS;
  }

  getLocalTick(): number {
    return this.currentTick;
  }
}
