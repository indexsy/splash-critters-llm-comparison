import {
  CONFIG,
  createRoundState,
  simulateTick,
  type Arena,
  type ArenaRoundStart,
  type MatchConfig,
  type PlayerInput,
  type PlayerState,
  type RoundSnapshot,
  type RoundState,
} from "@splash/shared";

interface StoredInput extends PlayerInput {
  pressedAt: number;
}

export class LocalPredictor {
  private config: MatchConfig | null = null;
  private roundData: ArenaRoundStart | null = null;
  private base: Arena | null = null;
  private castles: number[][] = [];
  private state: RoundState | null = null;
  private history: StoredInput[] = [];
  private localId = "";
  private lastAck = 0;
  private latestInput: PlayerInput | null = null;
  private ackedBalloon = false;

  setMatch(config: MatchConfig, localId: string): void {
    this.config = config;
    this.localId = localId;
    this.roundData = null;
    this.base = null;
    this.state = null;
    this.history = [];
    this.latestInput = null;
    this.ackedBalloon = false;
  }

  setRound(data: ArenaRoundStart): void {
    if (!this.config) return;
    this.roundData = data;
    this.castles = data.castleGrid.map((row) => [...row]);
    this.base = {
      w: data.w,
      h: data.h,
      theme: data.theme,
      seed: data.mapSeed,
      boulders: data.boulderGrid.map((row) => [...row]),
      castles: this.castles.map((row) => [...row]),
      hidden: Array.from({ length: data.h }, () => Array.from({ length: data.w }, () => null)),
      spawnTiles: data.spawnTiles.map((spawn) => ({ ...spawn })),
    };
    this.state = this.buildRoundState([]);
    this.history = [];
    this.latestInput = null;
    this.lastAck = 0;
    this.ackedBalloon = false;
  }

  onCastleWashed(x: number, y: number): void {
    if (this.castles[y]?.[x] !== undefined) this.castles[y]![x] = 0;
  }

  private buildRoundState(players: RoundSnapshot["players"]): RoundState {
    const config = this.config;
    const roundData = this.roundData;
    const base = this.base;
    if (!config || !roundData || !base) throw new Error("Prediction round is not ready");
    const arena: Arena = {
      ...base,
      boulders: base.boulders.map((row) => [...row]),
      castles: this.castles.map((row) => [...row]),
      hidden: base.hidden.map((row) => [...row]),
      spawnTiles: base.spawnTiles.map((spawn) => ({ ...spawn })),
    };
    const participants = config.players.map((player, index) => ({
      id: player.id,
      slot: index,
      name: player.name,
      animal: player.animal,
      hat: player.hat,
      isBot: player.isBot,
      difficulty: player.difficulty,
    }));
    const state = createRoundState(config.mode, arena, participants, {
      roundNo: roundData.roundNo,
      enableKick: CONFIG.ENABLE_KICK,
      enableRevengeDucks: !config.ranked && CONFIG.ENABLE_REVENGE_DUCKS,
    });
    if (players.length > 0) {
      state.players = players.map((player) => this.playerFromSnapshot(player));
    }
    return state;
  }

  private playerFromSnapshot(player: RoundSnapshot["players"][number]): PlayerState {
    return {
      id: player.id,
      slot: player.slot,
      name: player.name,
      animal: player.animal,
      hat: player.hat,
      x: player.x,
      y: player.y,
      dir: player.dir,
      alive: player.alive,
      eliminatedTick: player.eliminatedTick,
      speed: player.speed,
      balloonCount: player.balloonCount,
      splashRange: player.splashRange,
      kickCharges: player.kickCharges,
      isBot: player.isBot,
      difficulty: player.difficulty,
      prevBalloonPressed: player.id === this.localId ? this.ackedBalloon : false,
      revengeReadyTick: player.revengeReadyTick,
      soakedAtX: player.soakedAtX,
      soakedAtY: player.soakedAtY,
    };
  }

  pushInput(input: PlayerInput): void {
    this.history.push({ ...input, pressedAt: performance.now() });
    if (this.history.length > 120) this.history.shift();
    this.latestInput = input;
    if (!this.state || !this.roundData) return;
    const local = this.state.players.find((player) => player.id === this.localId);
    if (!local || !local.alive) return;
    simulateTick(this.state, { [this.localId]: input });
  }

  onSnapshot(snapshot: RoundSnapshot, ack: number): void {
    if (!this.config || !this.roundData) return;
    this.lastAck = Math.max(this.lastAck, ack);
    const acked = this.history.filter((entry) => entry.seq <= this.lastAck);
    const lastAcked = acked[acked.length - 1];
    this.ackedBalloon = lastAcked?.balloonPressed ?? false;
    this.history = this.history.filter((entry) => entry.seq > this.lastAck);
    const state = this.buildRoundState(snapshot.players);
    state.tick = snapshot.tick;
    state.balloons = snapshot.balloons.map((balloon) => ({ ...balloon }));
    state.splashes = snapshot.splashes.map((splash) => ({ ...splash }));
    state.powerups = snapshot.powerups.map((powerup) => ({ ...powerup }));
    state.tide = { ...snapshot.tide };
    state.ended = snapshot.ended;
    state.winnerId = snapshot.winnerId;
    state.draw = snapshot.draw;
    state.nextIds =
      Math.max(
        0,
        ...state.balloons.map((balloon) => balloon.id),
        ...state.splashes.map((splash) => splash.id),
        ...state.powerups.map((powerup) => powerup.id),
      ) + 1;
    for (const input of this.history) {
      const local = state.players.find((player) => player.id === this.localId);
      if (!local || !local.alive) break;
      simulateTick(state, { [this.localId]: input });
    }
    this.state = state;
  }

  getState(): RoundState | null {
    return this.state;
  }

  getLocal(): PlayerState | null {
    return this.state?.players.find((player) => player.id === this.localId) ?? null;
  }

  getLatestInput(): PlayerInput | null {
    return this.latestInput;
  }

  resetInputsForNewRound(): void {
    this.history = [];
    this.latestInput = null;
    this.lastAck = 0;
    this.ackedBalloon = false;
  }
}
