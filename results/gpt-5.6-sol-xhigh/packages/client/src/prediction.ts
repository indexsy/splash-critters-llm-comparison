import { CONFIG, cloneGameState, simulateTick } from "@splash/shared";
import type { Direction, GameState, PlayerInput, SimPlayer } from "@splash/shared";

export interface InputFrame {
  seq: number;
  tick: number;
  dir: Direction;
  balloonPressed: boolean;
  revengePressed: boolean;
  t: number;
}

interface Snap {
  serverTime: number;
  receivedAt: number;
  state: GameState;
  ackSeq: number;
}

export interface RenderPlayer extends SimPlayer {
  renderX: number;
  renderY: number;
  renderFx: number;
}

export class Prediction {
  private localId: string | null = null;
  private pending: InputFrame[] = [];
  private seq = 0;
  private snaps: Snap[] = [];
  private ackState: GameState | null = null;
  private predicted: GameState | null = null;
  private lastTickSeen = -1;
  private lastDir: Direction = "none";

  setLocalId(id: string): void {
    this.localId = id;
    this.reset();
  }

  reset(): void {
    this.pending = [];
    this.snaps = [];
    this.ackState = null;
    this.predicted = null;
    this.seq = 0;
    this.lastTickSeen = -1;
    this.lastDir = "none";
  }

  hasState(): boolean { return this.predicted !== null; }

  currentTick(): number { return this.predicted?.tick ?? this.ackState?.tick ?? -1; }
  lastAckSeq(): number { return this.snaps.length ? this.snaps[this.snaps.length - 1]!.ackSeq : 0; }

  frame(dir: Direction, balloonPressed: boolean, revengePressed: boolean): { msg: PlayerInput; frame: InputFrame } | null {
    if (!this.predicted || !this.localId) return null;
    const id = this.localId;
    this.seq++;
    const frame: InputFrame = {
      seq: this.seq,
      tick: this.predicted.tick + 1,
      dir,
      balloonPressed,
      revengePressed,
      t: performance.now()
    };
    this.pending.push(frame);
    this.lastDir = dir;
    this.predictLocal([frame]);
    const msg: PlayerInput = {
      playerId: id,
      seq: frame.seq,
      tick: frame.tick,
      dir,
      balloonPressed,
      ...(revengePressed ? { revengePressed: true } : {})
    };
    return { msg, frame };
  }

  applyAuthoritative(state: GameState, ackSeq: number, serverTime: number): { events: { tick: number }[]; resimmed: boolean } {
    if (this.lastTickSeen >= state.tick && this.ackState && state.tick === this.ackState.tick) {
      this.snaps.push({ serverTime, receivedAt: performance.now(), state: cloneGameState(state), ackSeq });
      if (this.snaps.length > 16) this.snaps.shift();
      return { events: [], resimmed: false };
    }
    this.lastTickSeen = state.tick;
    this.ackState = cloneGameState(state);
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => p.seq > ackSeq);
    void before;
    this.snaps.push({ serverTime, receivedAt: performance.now(), state: cloneGameState(state), ackSeq });
    if (this.snaps.length > 16) this.snaps.shift();
    this.resim();
    return { events: [], resimmed: true };
  }

  private predictLocal(frames: InputFrame[]): void {
    if (!this.predicted || !this.localId) return;
    const id = this.localId;
    for (const f of frames) {
      while (this.predicted.tick < f.tick) {
        simulateTick(this.predicted, []);
      }
      const inputs: PlayerInput[] = [{
        playerId: id,
        seq: f.seq,
        tick: f.tick,
        dir: f.dir,
        balloonPressed: f.balloonPressed,
        ...(f.revengePressed ? { revengePressed: true } : {})
      }];
      simulateTick(this.predicted, inputs);
    }
  }

  private resim(): void {
    if (!this.ackState) return;
    const rebuilt = cloneGameState(this.ackState);
    const sorted = [...this.pending].sort((a, b) => a.tick - b.tick);
    let i = 0;
    let guard = 0;
    while (i < sorted.length && guard < 1000) {
      guard++;
      const tickTarget = sorted[i]!.tick;
      while (rebuilt.tick < tickTarget) {
        simulateTick(rebuilt, []);
      }
      const bucket: InputFrame[] = [];
      while (i < sorted.length && sorted[i]!.tick === tickTarget) {
        bucket.push(sorted[i]!);
        i++;
      }
      if (this.localId) {
        const id = this.localId;
        const inputs: PlayerInput[] = bucket.map((f) => ({
          playerId: id,
          seq: f.seq,
          tick: f.tick,
          dir: f.dir,
          balloonPressed: f.balloonPressed,
          ...(f.revengePressed ? { revengePressed: true } : {})
        }));
        simulateTick(rebuilt, inputs);
      }
    }
    this.predicted = rebuilt;
  }

  interpolateSnapshots(now: number, lerpAlpha: number): void {
    if (!this.predicted) return;
    const renderDelay = CONFIG.INTERPOLATION_DELAY_MS;
    const target = now - renderDelay;
    let a: Snap | null = null;
    let b: Snap | null = null;
    for (let i = 0; i < this.snaps.length - 1; i++) {
      const cur = this.snaps[i]!;
      const next = this.snaps[i + 1]!;
      if (cur.receivedAt <= target && next.receivedAt >= target) { a = cur; b = next; break; }
    }
    if (!a || !b) {
      const last = this.snaps[this.snaps.length - 1];
      if (last) a = last;
    }
    if (!a) return;
    void b;
    void lerpAlpha;
  }

  predictedState(): GameState | null { return this.predicted; }
  renderState(now: number): GameState | null {
    if (!this.predicted) return null;
    const rendered = cloneGameState(this.predicted);
    const target = now - CONFIG.INTERPOLATION_DELAY_MS;
    let a: Snap | undefined;
    let b: Snap | undefined;
    for (let index = 0; index < this.snaps.length - 1; index++) {
      const current = this.snaps[index]!;
      const next = this.snaps[index + 1]!;
      if (current.receivedAt <= target && next.receivedAt >= target) {
        a = current;
        b = next;
        break;
      }
    }
    a ??= this.snaps.at(-1);
    if (!a) return rendered;
    const alpha = b ? Math.max(0, Math.min(1, (target - a.receivedAt) / Math.max(1, b.receivedAt - a.receivedAt))) : 1;
    for (const player of rendered.players) {
      if (player.id === this.localId) continue;
      const from = a.state.players.find((candidate) => candidate.id === player.id);
      const to = b?.state.players.find((candidate) => candidate.id === player.id) ?? from;
      if (!from || !to) continue;
      player.x = from.x + (to.x - from.x) * alpha;
      player.y = from.y + (to.y - from.y) * alpha;
    }
    return rendered;
  }
  authoritativeState(): GameState | null { return this.ackState; }

  pendingCount(): number { return this.pending.length; }
  lastDirection(): Direction { return this.lastDir; }
}
