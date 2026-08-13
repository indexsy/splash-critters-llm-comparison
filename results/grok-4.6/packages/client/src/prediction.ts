import {
  CONFIG,
  cloneRound,
  simulateTick,
  type PlayerInput,
  type RoundState,
  type SnapshotPayload,
} from "@splash/shared";

export class Predictor {
  localId = "";
  predicted: RoundState | null = null;
  pending: PlayerInput[] = [];
  lastAck = 0;
  seq = 0;
  remotes = new Map<string, { x: number; y: number; tx: number; ty: number }>();

  reset(state: RoundState, localId: string): void {
    this.localId = localId;
    this.predicted = cloneRound(state);
    this.pending = [];
    this.lastAck = 0;
    this.seq = 0;
    this.remotes.clear();
  }

  sample(dir: PlayerInput["dir"], balloon: boolean, tick: number): PlayerInput {
    const input: PlayerInput = { seq: ++this.seq, tick, dir, balloonPressed: balloon };
    this.pending.push(input);
    const cutoff = tick - Math.ceil(CONFIG.INPUT_BUFFER_MS / (1000 / CONFIG.TICK_RATE));
    this.pending = this.pending.filter((i) => i.tick >= cutoff);
    return input;
  }

  applyLocal(input: PlayerInput, revenge: boolean): void {
    if (!this.predicted) return;
    const map = new Map<string, PlayerInput>([[this.localId, input]]);
    simulateTick(this.predicted, map, { enableRevengeDucks: revenge });
  }

  reconcile(snap: SnapshotPayload, base: RoundState, revenge: boolean): void {
    const next = cloneRound(base);
    next.tick = snap.tick;
    next.players = snap.players.map((p) => ({ ...p }));
    next.balloons = snap.balloons.map((b) => ({ ...b }));
    next.splashes = snap.splashes.map((s) => ({ ...s }));
    next.exposed = snap.exposed.map((e) => ({ ...e }));
    next.tideRing = snap.tideRing;
    next.hitstop = snap.hitstop;
    this.pending = this.pending.filter((i) => i.seq > this.lastAck);
    for (const input of this.pending) {
      simulateTick(next, new Map([[this.localId, input]]), { enableRevengeDucks: revenge });
    }
    this.predicted = next;
    for (const p of snap.players) {
      if (p.id === this.localId) continue;
      const prev = this.remotes.get(p.id);
      this.remotes.set(p.id, {
        x: prev?.x ?? p.x,
        y: prev?.y ?? p.y,
        tx: p.x,
        ty: p.y,
      });
    }
  }

  interpRemotes(dt: number): void {
    const k = Math.min(1, dt * 12);
    for (const r of this.remotes.values()) {
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
    }
  }
}

export const predictor = new Predictor();
