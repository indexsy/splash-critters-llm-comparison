import {
  CONFIG,
  cloneState,
  createRoundState,
  simulateTick,
  type Dir,
  type GameState,
  type InputMap,
  type MapTheme,
  type MatchConfig,
  type PlayerInput,
  type Snapshot,
} from '@splash/shared';

export type LocalInput = PlayerInput & { clientTime: number };

/**
 * Client prediction: buffer local inputs, predict local player,
 * reconcile on snapshot by rewind-replay.
 */
export class Prediction {
  state: GameState | null = null;
  localId: string | null = null;
  inputBuffer: LocalInput[] = [];
  seq = 0;
  lastAckSeq = 0;
  remoteInterp: Map<string, Array<{ t: number; x: number; y: number; dir: Dir; moving: boolean }>> = new Map();
  grid: number[] = [];
  width = 13;
  height = 11;
  theme: MapTheme = 'backyard';

  startRound(
    config: MatchConfig,
    round: {
      mapSeed: number;
      castleGrid: number[];
      theme: MapTheme;
      width: number;
      height: number;
    },
    localId: string,
  ): void {
    this.localId = localId;
    this.width = round.width;
    this.height = round.height;
    this.theme = round.theme;
    this.grid = round.castleGrid.slice();
    this.inputBuffer = [];
    this.seq = 0;
    this.lastAckSeq = 0;
    this.remoteInterp.clear();

    this.state = createRoundState({
      width: round.width,
      height: round.height,
      mapSeed: round.mapSeed,
      theme: round.theme,
      ranked: config.ranked,
      players: config.players.map((p) => ({
        id: p.id,
        slot: p.slot,
        nickname: p.nickname,
        animal: p.animal,
        hat: p.hat,
        isBot: p.isBot,
      })),
    });
    // Use server grid
    this.state.grid = round.castleGrid.slice();
  }

  pushInput(dir: Dir, balloonPressed: boolean, serverTick: number): PlayerInput {
    this.seq++;
    const input: LocalInput = {
      seq: this.seq,
      tick: serverTick,
      dir,
      balloonPressed,
      clientTime: performance.now(),
    };
    this.inputBuffer.push(input);
    // Keep ~1s buffer
    const max = CONFIG.TICK_RATE;
    if (this.inputBuffer.length > max) {
      this.inputBuffer.splice(0, this.inputBuffer.length - max);
    }

    // Predict local immediately
    if (this.state && this.localId) {
      const inputs: InputMap = { [this.localId]: input };
      // Don't full sim — only move local for snappy feel; full recon on snap
      simulateTick(this.state, inputs);
    }
    return input;
  }

  applySnapshot(snap: Snapshot): void {
    if (!this.state || !this.localId) {
      // Store remote positions even without full state
      this.storeRemote(snap);
      return;
    }

    const local = snap.players.find((p) => p.id === this.localId);
    const ackSeq = local?.inputSeq ?? this.lastAckSeq;
    this.lastAckSeq = ackSeq;

    // Rebuild state from snapshot for authority
    const newState = cloneState(this.state);
    newState.tick = snap.tick;
    newState.tideRing = snap.tideRing;
    newState.livingCount = snap.livingCount;
    newState.balloons = snap.balloons.map((b) => ({ ...b }));
    newState.splashes = snap.splashes.map((s) => ({ ...s, tiles: s.tiles.map((t) => ({ ...t })) }));
    newState.powerups = snap.powerups.map((p) => ({ ...p }));

    for (const sp of snap.players) {
      const p = newState.players.find((x) => x.id === sp.id);
      if (!p) continue;
      if (sp.id === this.localId) {
        // Authoritative position for local — then replay unacked inputs
        p.x = sp.x;
        p.y = sp.y;
        p.dir = sp.dir;
        p.moving = sp.moving;
        p.speed = sp.speed;
        p.balloonCount = sp.balloonCount;
        p.splashRange = sp.splashRange;
        p.balloonsOut = sp.balloonsOut;
        p.hasBoots = sp.hasBoots;
        p.soaked = sp.soaked;
        p.alive = sp.alive;
        p.revenge = sp.revenge;
        p.soaks = sp.soaks;
        p.inputSeq = sp.inputSeq;
      } else {
        p.x = sp.x;
        p.y = sp.y;
        p.dir = sp.dir;
        p.moving = sp.moving;
        p.speed = sp.speed;
        p.balloonCount = sp.balloonCount;
        p.splashRange = sp.splashRange;
        p.balloonsOut = sp.balloonsOut;
        p.hasBoots = sp.hasBoots;
        p.soaked = sp.soaked;
        p.alive = sp.alive;
        p.revenge = sp.revenge;
        p.soaks = sp.soaks;
      }
    }

    // Drop acked inputs
    this.inputBuffer = this.inputBuffer.filter((i) => i.seq > ackSeq);

    // Replay unacked for local player only
    for (const inp of this.inputBuffer) {
      const inputs: InputMap = { [this.localId]: inp };
      // Simulate with only local — remote already at snap
      const remoteDirs = new Map(newState.players.filter((p) => p.id !== this.localId).map((p) => [p.id, { x: p.x, y: p.y }]));
      simulateTick(newState, inputs);
      // Restore remote positions (they shouldn't move from our prediction)
      for (const p of newState.players) {
        if (p.id === this.localId) continue;
        const r = remoteDirs.get(p.id);
        if (r) {
          p.x = r.x;
          p.y = r.y;
        }
      }
    }

    this.state = newState;
    this.storeRemote(snap);
  }

  private storeRemote(snap: Snapshot): void {
    const now = performance.now();
    for (const p of snap.players) {
      if (p.id === this.localId) continue;
      let buf = this.remoteInterp.get(p.id);
      if (!buf) {
        buf = [];
        this.remoteInterp.set(p.id, buf);
      }
      buf.push({ t: now, x: p.x, y: p.y, dir: p.dir, moving: p.moving });
      if (buf.length > 30) buf.shift();
    }
  }

  /** Interpolated remote position at render time */
  getRemotePos(playerId: string): { x: number; y: number; dir: Dir; moving: boolean } | null {
    const buf = this.remoteInterp.get(playerId);
    if (!buf || buf.length === 0) return null;
    const renderTime = performance.now() - CONFIG.INTERP_DELAY_MS;
    if (buf.length === 1) return buf[0]!;

    let a = buf[0]!;
    let b = buf[buf.length - 1]!;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i]!.t <= renderTime && buf[i + 1]!.t >= renderTime) {
        a = buf[i]!;
        b = buf[i + 1]!;
        break;
      }
    }
    if (renderTime <= a.t) return a;
    if (renderTime >= b.t) return b;
    const t = (renderTime - a.t) / (b.t - a.t);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      dir: b.dir,
      moving: b.moving,
    };
  }

  applyEvents(events: import('@splash/shared').GameEvent[]): void {
    if (!this.state) return;
    for (const e of events) {
      if (e.type === 'castle_washed') {
        const i = e.y * this.state.width + e.x;
        this.state.grid[i] = 0;
      }
    }
  }
}
