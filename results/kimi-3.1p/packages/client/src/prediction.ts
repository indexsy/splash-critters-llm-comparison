import { CONFIG, applySnapshot, cloneGameState, createClientGameState, mapIndex, simulateTick, syncTide, TILE } from "@splash/shared";
import type {
  BalloonState,
  ClientMessage,
  Direction,
  GameEvent,
  GameState,
  MatchConfig,
  PlayerDescriptor,
  PlayerInput,
  PlayerState,
  Snapshot
} from "@splash/shared";

interface PendingInput {
  input: PlayerInput;
}

interface TimedSnapshot {
  serverTime: number;
  snapshot: Snapshot;
}

export class Prediction {
  state: GameState | null = null;
  private predicted: GameState | null = null;
  private localPlayerId = "";
  private pending: PendingInput[] = [];
  private history: TimedSnapshot[] = [];
  private sequence = 0;

  startRound(
    message: { roundNo: number; mapSeed: number; castleGrid: GameState["map"]["tiles"]; width: number; height: number; serverTick: number },
    config: MatchConfig,
    players: PlayerDescriptor[],
    localPlayerId: string
  ): void {
    this.localPlayerId = localPlayerId;
    this.state = createClientGameState(config, players, message.roundNo, message.mapSeed, message.width, message.height, message.castleGrid);
    this.state.tick = message.serverTick;
    this.state.roundStartedTick = message.serverTick;
    this.predicted = cloneGameState(this.state);
    this.pending = [];
    this.history = [];
  }

  reset(): void {
    this.state = null;
    this.predicted = null;
    this.pending = [];
    this.history = [];
    this.sequence = 0;
  }

  applySnapshot(snapshot: Snapshot, serverTime: number): void {
    if (!this.state || snapshot.round !== this.state.round || snapshot.mapSeed !== this.state.mapSeed) return;
    applySnapshot(this.state, snapshot);
    for (let index = 0; index < this.state.map.tiles.length; index += 1) {
      if (this.state.map.flooded[index] && this.state.map.tiles[index] === TILE.CASTLE) {
        this.state.map.tiles[index] = TILE.FLOOR;
        this.state.map.hiddenPowerups[index] = null;
      }
    }
    this.history.push({ serverTime, snapshot });
    if (this.history.length > 20) this.history.shift();
    const acknowledged = snapshot.players.find((player) => player.id === this.localPlayerId)?.lastInputSeq ?? 0;
    this.pending = this.pending.filter((pending) => pending.input.seq > acknowledged);
    this.predicted = cloneGameState(this.state);
    for (const pending of this.pending) simulateTick(this.predicted, { [this.localPlayerId]: pending.input });
  }

  step(dir: Direction, balloonPressed: boolean): Extract<ClientMessage, { type: "input" }> | null {
    if (!this.state || !this.predicted || !this.localPlayerId) return null;
    this.sequence += 1;
    const input: PlayerInput = { seq: this.sequence, dir, balloonPressed };
    this.pending.push({ input });
    if (this.pending.length > CONFIG.INPUT_BUFFER_SIZE) this.pending.shift();
    simulateTick(this.predicted, { [this.localPlayerId]: input });
    return { type: "input", seq: input.seq, tick: this.state.tick + this.pending.length, dir, balloonPressed };
  }

  applyEvent(event: GameEvent): void {
    const states = [this.state, this.predicted].filter((state): state is GameState => Boolean(state));
    for (const state of states) {
      if (event.type === "castle_washed") {
        const index = mapIndex(state.map, event.x, event.y);
        state.map.tiles[index] = TILE.FLOOR;
        state.map.hiddenPowerups[index] = null;
      }
      if (event.type === "tide_advance") {
        const changed = syncTide(state.map, event.ring);
        for (const index of changed) {
          state.map.tiles[index] = TILE.FLOOR;
          state.map.hiddenPowerups[index] = null;
        }
      }
      if (event.type === "powerup_revealed" && !state.powerups.some((powerup) => powerup.id === event.id)) {
        state.powerups.push({ id: event.id, x: event.x, y: event.y, kind: event.kind, revealedTick: event.tick });
      }
      if (event.type === "powerup_collected" || event.type === "powerup_destroyed") {
        state.powerups = state.powerups.filter((powerup) => powerup.id !== event.id);
      }
      if (event.type === "player_soaked") {
        const player = state.players.find((candidate) => candidate.id === event.playerId);
        if (player) player.alive = false;
      }
    }
  }

  localPlayer(): PlayerState | null {
    return this.predicted?.players.find((player) => player.id === this.localPlayerId) ?? null;
  }

  positionFor(player: PlayerState, serverNow: number): { x: number; y: number } {
    if (player.id === this.localPlayerId) {
      const predicted = this.predicted?.players.find((candidate) => candidate.id === player.id);
      if (predicted) return { x: predicted.x, y: predicted.y };
    }
    const target = serverNow - CONFIG.INTERPOLATION_MS;
    let before: TimedSnapshot | null = null;
    let after: TimedSnapshot | null = null;
    for (const entry of this.history) {
      if (entry.serverTime <= target) before = entry;
      if (entry.serverTime >= target) {
        after = entry;
        break;
      }
    }
    if (!before || !after || before === after) return { x: player.x, y: player.y };
    const previous = before.snapshot.players.find((candidate) => candidate.id === player.id);
    const next = after.snapshot.players.find((candidate) => candidate.id === player.id);
    if (!previous || !next) return { x: player.x, y: player.y };
    const ratio = Math.max(0, Math.min(1, (target - before.serverTime) / Math.max(1, after.serverTime - before.serverTime)));
    return { x: previous.x + (next.x - previous.x) * ratio, y: previous.y + (next.y - previous.y) * ratio };
  }

  balloonPosition(balloon: BalloonState, serverNow: number): { x: number; y: number } {
    if (!balloon.kickDir) return { x: balloon.x, y: balloon.y };
    const target = serverNow - CONFIG.INTERPOLATION_MS;
    const before = [...this.history].reverse().find((entry) => entry.serverTime <= target);
    const after = this.history.find((entry) => entry.serverTime >= target);
    if (!before || !after || before === after) return { x: balloon.x, y: balloon.y };
    const previous = before.snapshot.balloons.find((candidate) => candidate.id === balloon.id);
    const next = after.snapshot.balloons.find((candidate) => candidate.id === balloon.id);
    if (!previous || !next) return { x: balloon.x, y: balloon.y };
    const ratio = Math.max(0, Math.min(1, (target - before.serverTime) / Math.max(1, after.serverTime - before.serverTime)));
    return { x: previous.x + (next.x - previous.x) * ratio, y: previous.y + (next.y - previous.y) * ratio };
  }
}
