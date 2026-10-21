import {
  CONFIG,
  createMatchState,
  beginRound,
  simulateTick,
  type GameState,
  type PlayerInput,
  type Snapshot,
  type Theme,
} from '@splash-critters/shared';

export interface LocalInput {
  seq: number;
  dir: number;
  balloon: boolean;
}

interface HistoryEntry {
  tick: number;
  state: GameState;
  inputs: PlayerInput[];
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    arena: { ...state.arena, castles: state.arena.castles.slice(), contents: state.arena.contents.slice() },
    players: state.players.map((p) => ({ ...p, duck: p.duck ? { ...p.duck } : null })),
    balloons: state.balloons.map((b) => ({ ...b })),
    splashes: state.splashes.map((s) => ({ ...s, lens: [...s.lens] as [number, number, number, number] })),
    exposed: state.exposed.map((e) => ({ ...e })),
    events: [],
    lastSoaked: [],
  };
}

/**
 * Client side prediction. The client runs the very same simulation as the
 * server for the local player, keeps a short history and rewinds/replays it
 * whenever an authoritative snapshot arrives.
 */
export class Predictor {
  state: GameState | null = null;
  localId = -1;
  ackedSeq = 0;
  /** Visual correction that decays after every reconciliation. */
  offsetX = 0;
  offsetY = 0;

  private history: HistoryEntry[] = [];
  private pending: LocalInput[] = [];
  private remoteDirs = new Map<number, number>();
  private seq = 0;

  reset(): void {
    this.state = null;
    this.history.length = 0;
    this.pending.length = 0;
    this.remoteDirs.clear();
    this.seq = 0;
    this.ackedSeq = 0;
    this.localId = -1;
  }

  /** Builds the local world for a new round from the authoritative grid. */
  startRound(opts: {
    roundNo: number;
    mapSeed: number;
    castleGrid: string;
    theme: Theme;
    mode: 'duel' | 'ffa';
    roundsToWin: number;
    players: {
      animal: GameState['players'][number]['animal'];
      hat: GameState['players'][number]['hat'];
      nickname?: string;
      tag?: string;
    }[];
    localId: number;
  }): void {
    const state = createMatchState({
      mode: opts.mode,
      roundsToWin: opts.roundsToWin,
      theme: opts.theme,
      seed: opts.mapSeed,
      players: opts.players,
      revengeDucks: true,
      enableKick: CONFIG.ENABLE_KICK,
    });
    beginRound(state, opts.roundNo, opts.mapSeed, opts.theme);
    if (opts.castleGrid) {
      const cells = opts.castleGrid.split('');
      for (let i = 0; i < state.arena.castles.length && i < cells.length; i++) {
        state.arena.castles[i] = cells[i] === '1' ? 1 : 0;
        // the hidden contents stay unknown to the client
        state.arena.contents[i] = null;
      }
    }
    state.players.forEach((player, index) => {
      const info = opts.players[index];
      if (!info) return;
      player.nickname = info.nickname ?? '';
      player.tag = info.tag ?? '';
    });
    this.state = state;
    this.localId = opts.localId;
    this.history.length = 0;
    this.pending.length = 0;
    this.remoteDirs.clear();
    this.seq = 0;
    this.ackedSeq = 0;
  }

  /** Records a local input and returns the packet that should be sent. */
  queueInput(dir: number, balloon: boolean): LocalInput {
    this.seq += 1;
    const input: LocalInput = { seq: this.seq, dir, balloon };
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    return input;
  }

  get inputSeq(): number {
    return this.seq;
  }

  /** Applies an authoritative snapshot and replays the unacknowledged inputs. */
  applySnapshot(snapshot: Snapshot): void {
    if (!this.state) return;
    const local = snapshot.players[this.localId];
    if (local) this.ackedSeq = Math.max(this.ackedSeq, local.lastSeq);

    for (const player of snapshot.players) {
      if (player.id === this.localId) continue;
      const dir = dirFromFacing(player.facing, player.moving);
      this.remoteDirs.set(player.id, dir);
    }

    // find the newest history entry that is not ahead of the snapshot
    let base: HistoryEntry | null = null;
    for (const entry of this.history) {
      if (entry.tick <= snapshot.tick && (!base || entry.tick > base.tick)) base = entry;
    }

    let restored: GameState;
    let replayFrom = 0;
    if (base) {
      restored = cloneState(base.state);
      replayFrom = base.tick;
    } else {
      restored = this.stateFromSnapshot(snapshot);
      replayFrom = snapshot.tick;
    }

    // visual smoothing for the local player
    const before = this.state.players[this.localId];
    const after = restored.players[this.localId];
    if (before && after) {
      this.offsetX = before.x - after.x;
      this.offsetY = before.y - after.y;
    }

    this.state = restored;

    // replay everything that happened after the restored tick
    const replayed = this.history.filter((entry) => entry.tick > replayFrom);
    for (const entry of replayed) {
      simulateTick(this.state, entry.inputs);
    }
    // and the local inputs the server has not processed yet
    const unacked = this.pending.filter((input) => input.seq > this.ackedSeq);
    for (const input of unacked) {
      simulateTick(this.state, [this.localInput(input), ...this.remoteInputs()]);
    }
    this.history = this.history.filter((entry) => entry.tick > replayFrom);
  }

  /** Advances the local simulation by one tick. */
  tick(local: LocalInput | null): void {
    if (!this.state) return;
    const inputs: PlayerInput[] = [];
    if (local) inputs.push(this.localInput(local));
    inputs.push(...this.remoteInputs());
    simulateTick(this.state, inputs);
    this.history.push({ tick: this.state.tick, state: cloneState(this.state), inputs });
    if (this.history.length > 120) this.history.shift();
  }

  private localInput(input: LocalInput): PlayerInput {
    return {
      playerId: this.localId,
      seq: input.seq,
      dir: input.dir,
      balloon: input.balloon,
    };
  }

  private remoteInputs(): PlayerInput[] {
    if (!this.state) return [];
    const out: PlayerInput[] = [];
    for (const player of this.state.players) {
      if (player.id === this.localId) continue;
      out.push({
        playerId: player.id,
        seq: 0,
        dir: this.remoteDirs.get(player.id) ?? 0,
        balloon: false,
      });
    }
    return out;
  }

  private stateFromSnapshot(snapshot: Snapshot): GameState {
    const base = this.state!;
    const state = cloneState(base);
    state.tick = snapshot.tick;
    state.phase = snapshot.phase;
    state.roundNo = snapshot.roundNo;
    state.countdown = snapshot.countdown;
    state.timeLeft = snapshot.timeLeft;
    state.tideRing = snapshot.tideRing;
    if (snapshot.castles) {
      const cells = snapshot.castles.split('');
      for (let i = 0; i < state.arena.castles.length && i < cells.length; i++) {
        state.arena.castles[i] = cells[i] === '1' ? 1 : 0;
      }
    }
    for (const player of snapshot.players) {
      const target = state.players[player.id];
      if (!target) continue;
      target.x = player.x;
      target.y = player.y;
      target.facing = player.facing as GameState['players'][number]['facing'];
      target.moving = player.moving;
      target.alive = player.alive;
      target.speed = player.speed;
      target.balloonCount = player.balloonCount;
      target.splashRange = player.splashRange;
      target.hasBoots = player.hasBoots;
      target.roundWins = player.roundWins;
      target.soaks = player.soaks;
      target.castlesWashed = player.castlesWashed;
      target.biggestChain = player.biggestChain;
      target.lastSeq = player.lastSeq;
      target.nickname = player.nickname;
      target.tag = player.tag;
      target.duck = player.duck ? { x: player.duck.x, y: player.duck.y, dist: 0, dir: player.duck.dir, cooldown: 0 } : null;
    }
    state.balloons = snapshot.balloons.map((b) => ({
      id: b.id,
      owner: b.owner,
      x: b.x,
      y: b.y,
      fuse: b.fuse,
      range: b.range,
      revenge: b.revenge,
      sliding: b.sliding,
      slideDir: b.slideDir,
      slideCooldown: 0,
    }));
    state.splashes = snapshot.splashes.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      lens: [...s.lens] as [number, number, number, number],
      ticks: s.ticks,
      depth: s.depth,
      owner: 0,
      revenge: false,
    }));
    state.exposed = snapshot.exposed.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      kind: e.kind as GameState['exposed'][number]['kind'],
    }));
    return state;
  }

  decayOffset(): void {
    this.offsetX *= 0.75;
    this.offsetY *= 0.75;
    if (Math.abs(this.offsetX) < 0.01) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.01) this.offsetY = 0;
  }
}

function dirFromFacing(facing: number, moving: boolean): number {
  if (!moving) return 0;
  switch (facing) {
    case 0:
      return 4;
    case 1:
      return 1;
    case 2:
      return 8;
    case 3:
      return 2;
    default:
      return 0;
  }
}
