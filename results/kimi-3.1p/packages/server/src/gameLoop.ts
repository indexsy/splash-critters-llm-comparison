import {
  CONFIG,
  createGameState,
  forceSoak,
  randomSeed,
  simulateTick,
  snapshotState,
  triggerEmote
} from "@splash/shared";
import type {
  BotDifficulty,
  GameEvent,
  GameState,
  MatchConfig,
  PlayerDescriptor,
  PlayerInput,
  ServerMessage
} from "@splash/shared";
import { sendMessage, type ClientConnection } from "./net.js";
import { BotBrain } from "./bots/bot.js";
import { buildDangerMap } from "./bots/dangerMap.js";

export interface RuntimePlayer {
  descriptor: PlayerDescriptor;
  accountId: string | null;
  connection: ClientConnection | null;
  difficulty: BotDifficulty | null;
  forfeited: boolean;
}

export interface GameLoopCallbacks {
  broadcast: (message: ServerMessage) => void;
  matchEnded: (state: GameState, players: RuntimePlayer[]) => void;
}

export class GameLoop {
  readonly state: GameState;
  readonly startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private lastPhase: GameState["phase"];
  private lastRound: number;
  private ended = false;
  private readonly brains = new Map<string, BotBrain>();
  private readonly pendingEmotes = new Map<string, number>();

  constructor(
    readonly players: RuntimePlayer[],
    readonly config: MatchConfig,
    readonly ratings: Record<string, number | null>,
    private readonly callbacks: GameLoopCallbacks,
    matchSeed = randomSeed()
  ) {
    this.state = createGameState(matchSeed, config, players.map((player) => player.descriptor));
    this.lastPhase = this.state.phase;
    this.lastRound = this.state.round;
    for (const player of players) {
      if (player.difficulty) this.brains.set(player.descriptor.id, new BotBrain(player.descriptor.id, player.difficulty, matchSeed));
    }
  }

  private descriptors(): PlayerDescriptor[] {
    return this.state.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      animal: player.animal,
      hat: player.hat,
      bot: player.bot,
      difficulty: player.difficulty
    }));
  }

  private matchStart(localPlayerId: string): ServerMessage {
    return { type: "match_start", config: this.config, players: this.descriptors(), localPlayerId, ratings: this.ratings };
  }

  private roundStart(): ServerMessage {
    return {
      type: "round_start",
      roundNo: this.state.round,
      mapSeed: this.state.mapSeed,
      castleGrid: [...this.state.map.tiles],
      width: this.state.map.width,
      height: this.state.map.height,
      theme: this.config.theme,
      serverTick: this.state.tick
    };
  }

  start(): void {
    for (const player of this.players) {
      if (player.connection) sendMessage(player.connection, this.matchStart(player.descriptor.id));
    }
    this.callbacks.broadcast(this.roundStart());
    this.callbacks.broadcast({ type: "snapshot", data: snapshotState(this.state), serverTime: Date.now() });
    this.lastTime = performance.now();
    this.timer = setInterval(() => this.frame(), 1000 / CONFIG.TICK_RATE);
  }

  resync(connection: ClientConnection): void {
    const player = this.players.find((candidate) => candidate.connection?.id === connection.id || candidate.descriptor.id === connection.id);
    if (!player) return;
    sendMessage(connection, this.matchStart(player.descriptor.id));
    sendMessage(connection, this.roundStart());
    sendMessage(connection, { type: "snapshot", data: snapshotState(this.state), serverTime: Date.now() });
    if (this.state.phase === "round_end") this.sendRoundEnd();
  }

  private sendRoundEnd(): void {
    this.callbacks.broadcast({
      type: "round_end",
      roundNo: this.state.round,
      winnerId: this.state.roundWinnerId,
      scores: Object.fromEntries(this.state.players.map((player) => [player.id, player.roundsWon]))
    });
  }

  private frame(): void {
    if (this.ended) return;
    const now = performance.now();
    this.accumulator += Math.min(250, now - this.lastTime);
    this.lastTime = now;
    const step = 1000 / CONFIG.TICK_RATE;
    let iterations = 0;
    while (this.accumulator >= step && iterations < 5) {
      this.tick();
      this.accumulator -= step;
      iterations += 1;
    }
    if (iterations === 5) this.accumulator = 0;
  }

  private inputFor(player: RuntimePlayer, danger: ReturnType<typeof buildDangerMap> | null): PlayerInput {
    if (player.difficulty) {
      const brain = this.brains.get(player.descriptor.id);
      if (brain && danger) return brain.input(this.state, danger);
    }
    const connection = player.connection;
    if (!connection) return { seq: 0, dir: "none", balloonPressed: false };
    const queued = connection.inputBuffer.shift();
    if (!queued) return { ...connection.lastInput, balloonPressed: false };
    connection.lastInput = queued;
    return queued;
  }

  private tick(): void {
    if (this.ended) return;
    const previousPhase = this.state.phase;
    const previousRound = this.state.round;
    const danger = this.state.phase === "playing" && this.brains.size > 0 ? buildDangerMap(this.state) : null;
    const inputs: Record<string, PlayerInput> = {};
    for (const player of this.players) inputs[player.descriptor.id] = this.inputFor(player, danger);
    const events: GameEvent[] = simulateTick(this.state, inputs);
    for (const [playerId, emote] of this.pendingEmotes) {
      const event = triggerEmote(this.state, playerId, emote);
      if (event) events.push(event);
    }
    this.pendingEmotes.clear();
    for (const event of events) this.callbacks.broadcast({ type: "event", event });
    if (this.state.round !== previousRound) {
      for (const player of this.players) {
        if (!player.forfeited) continue;
        const statePlayer = this.state.players.find((candidate) => candidate.id === player.descriptor.id);
        if (statePlayer) statePlayer.alive = false;
      }
      this.callbacks.broadcast(this.roundStart());
    }
    if (this.state.phase === "round_end" && previousPhase !== "round_end") this.sendRoundEnd();
    for (const player of this.players) {
      const statePlayer = this.state.players.find((candidate) => candidate.id === player.descriptor.id);
      if (statePlayer) statePlayer.ping = player.connection?.rtt ?? 0;
    }
    if (this.state.tick % Math.max(1, Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE)) === 0 || this.state.phase !== previousPhase) {
      this.callbacks.broadcast({ type: "snapshot", data: snapshotState(this.state), serverTime: Date.now() });
    }
    this.lastPhase = this.state.phase;
    this.lastRound = this.state.round;
    if (this.state.phase === "match_end" && previousPhase !== "match_end") this.finish();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.callbacks.matchEnded(this.state, this.players);
  }

  queueInput(connection: ClientConnection, input: PlayerInput): void {
    if (input.seq <= connection.lastReceivedSeq) return;
    connection.lastReceivedSeq = input.seq;
    if (connection.inputBuffer.length >= CONFIG.INPUT_BUFFER_SIZE) connection.inputBuffer.shift();
    connection.inputBuffer.push(input);
  }

  queueEmote(playerId: string, emote: number): void {
    this.pendingEmotes.set(playerId, emote);
  }

  setConnection(playerId: string, connection: ClientConnection): void {
    const player = this.players.find((candidate) => candidate.descriptor.id === playerId);
    if (player) {
      player.connection = connection;
      player.forfeited = false;
    }
  }

  convertToBot(playerId: string, difficulty: BotDifficulty): void {
    const player = this.players.find((candidate) => candidate.descriptor.id === playerId);
    if (!player || player.forfeited) return;
    player.connection = null;
    player.difficulty = difficulty;
    player.descriptor.bot = true;
    player.descriptor.difficulty = difficulty;
    const statePlayer = this.state.players.find((candidate) => candidate.id === playerId);
    if (statePlayer) {
      statePlayer.bot = true;
      statePlayer.difficulty = difficulty;
    }
    this.brains.set(playerId, new BotBrain(playerId, difficulty, this.state.matchSeed));
  }

  forfeit(playerId: string): void {
    const player = this.players.find((candidate) => candidate.descriptor.id === playerId);
    if (!player || player.forfeited || this.ended) return;
    player.forfeited = true;
    player.connection = null;
    if (this.config.mode === "duel") {
      const opponent = this.state.players.find((candidate) => candidate.id !== playerId);
      if (opponent) opponent.roundsWon = this.config.roundsToWin;
      const statePlayer = this.state.players.find((candidate) => candidate.id === playerId);
      if (statePlayer) statePlayer.alive = false;
      this.state.phase = "match_end";
      this.finish();
      return;
    }
    const events = forceSoak(this.state, playerId);
    for (const event of events) this.callbacks.broadcast({ type: "event", event });
  }

  stop(): void {
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
