import { CONFIG } from "@sc/shared";
import type { SnapshotPayload } from "@sc/shared";

export interface RemoteEntity {
  id: string;
  bx: number; // buffer of snapshots
  by: number;
  ax: number;
  ay: number;
  lastUpdateMs: number;
}

/**
 * Local prediction with soft reconciliation:
 * - local player integrates inputs immediately against the known grid
 * - server positions reconcile via exponential smoothing (snap on large error)
 * - remote entities interpolate between the two most recent snapshots at
 *   renderTime = serverTime - INTERP_DELAY
 */
export class Predictor {
  localX = 0;
  localY = 0;
  private pendingInputs: Array<{ seq: number; dirX: number; dirY: number }> = [];
  private seqCounter = 0;
  private remotePrev = new Map<string, { x: number; y: number; tick: number }>();
  private remoteCurr = new Map<string, { x: number; y: number; tick: number }>();
  private serverTimeOffset = 0;

  setLocal(x: number, y: number): void {
    this.localX = x;
    this.localY = y;
  }

  addInput(dirX: number, dirY: number): number {
    const seq = ++this.seqCounter;
    this.pendingInputs.push({ seq, dirX, dirY });
    if (this.pendingInputs.length > 120) this.pendingInputs.shift();
    return seq;
  }

  /** Apply one frame of local movement (dt seconds) with tile collision. */
  integrate(
    dt: number,
    dirX: number,
    dirY: number,
    speed: number,
    solidAt: (tx: number, ty: number) => boolean,
    canKick: boolean,
  ): void {
    const len = Math.hypot(dirX, dirY);
    if (len < 0.01) return;
    const nx = (dirX / len) * speed * dt;
    const ny = (dirY / len) * speed * dt;
    const HALF = 0.35;
    const boxSolid = (x: number, y: number): boolean => {
      const minX = Math.round(x - HALF);
      const maxX = Math.round(x + HALF);
      const minY = Math.round(y - HALF);
      const maxY = Math.round(y + HALF);
      for (let ty = minY; ty <= maxY; ty++)
        for (let tx = minX; tx <= maxX; tx++) if (solidAt(tx, ty)) return true;
      return false;
    };
    if (nx !== 0 && !boxSolid(this.localX + nx, this.localY)) this.localX += nx;
    if (ny !== 0 && !boxSolid(this.localX, this.localY + ny)) this.localY += ny;
    void canKick;
  }

  /** Reconcile with authoritative snapshot. */
  reconcile(snap: SnapshotPayload, myEntityId: string): void {
    const me = snap.players.find((p) => p.id === myEntityId);
    if (me) {
      const err = Math.hypot(me.x - this.localX, me.y - this.localY);
      if (err > 1.2) {
        this.localX = me.x;
        this.localY = me.y;
      } else {
        // soft pull toward authority
        this.localX += (me.x - this.localX) * 0.18;
        this.localY += (me.y - this.localY) * 0.18;
      }
    }
    this.remotePrev = this.remoteCurr;
    this.remoteCurr = new Map();
    for (const p of snap.players) {
      this.remoteCurr.set(p.id, { x: p.x, y: p.y, tick: snap.tick });
    }
    this.serverTimeOffset = Date.now() - snap.tick * CONFIG.tickMs;
  }

  /** Interpolated position for a remote entity. */
  remotePos(entityId: string): { x: number; y: number } | null {
    const curr = this.remoteCurr.get(entityId);
    if (!curr) return null;
    const prev = this.remotePrev.get(entityId) ?? curr;
    const now = Date.now() - this.serverTimeOffset - CONFIG.interpDelayMs;
    const curT = curr.tick * CONFIG.tickMs;
    const prevT = prev.tick * CONFIG.tickMs;
    const span = Math.max(1, curT - prevT);
    let t = (now - prevT) / span;
    t = Math.max(0, Math.min(1.25, t));
    return { x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t };
  }
}
