// Local-player prediction with rewind-replay reconciliation (ARCHITECTURE section 4).
//
// Every 30 Hz client tick the local player is moved immediately with the shared movement code
// (exactly what the server will do with the same input) and the input is kept until the server
// acknowledges it. On each snapshot the predicted world is rebuilt from the authoritative one,
// acknowledged inputs are dropped and the rest are replayed. The visual jump that a correction
// would cause is absorbed by a render offset that decays over ~100 ms (or snaps past one tile).
//
// Movement and the local player's own kicks are predicted. A kick only changes a balloon the
// client already knows by its server id, so it is simulated with the shared kick and slide code
// and the kicker walks on behind it at once, as on the server. Drops and revenge lobs create
// server entities (their ids come from the server), so they are never simulated; balloons kicked
// by anyone else stay where the snapshots put them.
import {
  CONFIG,
  Dir,
  cloneState,
  duckXY,
  movePlayer,
  slideBalloons,
  stepDuck,
  updatePassMasks,
  type Balloon,
  type DirCode,
  type RoundState,
} from '@splash/shared';

export interface PendingInput {
  seq: number;
  dir: DirCode;
}

/** Sub-unit position the local player is drawn at: the critter, or its revenge duck. */
export interface LocalPosition {
  x: number;
  y: number;
}

/**
 * One tick of the local player exactly as the server runs it for `dir`: walking while dry (and
 * kicking a balloon when the rules and Rubber Boots allow), riding the border on a revenge duck
 * once soaked, then sliding the balloons in `ownKicks` (the local player's own kicks; a kick made
 * now is added). Never places or lobs anything; a finished round no longer moves (as on the
 * server). Returns the id of the balloon kicked this tick, -1 if none.
 */
export function applyLocalMove(s: RoundState, slot: number, dir: DirCode, ownKicks: Set<number>): number {
  const p = s.players[slot];
  if (!p || !p.present || s.over) return -1;
  let kickedId = -1;
  if (p.alive) kickedId = movePlayer(s, p, dir, s.rules.kick && p.canKick).kickedId;
  else if (p.duckPos >= 0) stepDuck(s, p, { seq: 0, dir, balloon: false }, []);
  if (kickedId >= 0) ownKicks.add(kickedId);
  slideOwnKicks(s, ownKicks);
  updatePassMasks(s);
  return kickedId;
}

/**
 * Advances the local player's own sliding balloons one tick with the shared slide code (the
 * server's slide step). Any other sliding balloon is held still for the call: it is drawn from
 * snapshots, and advancing it here would make every remote kick jump ahead by a round trip.
 */
function slideOwnKicks(s: RoundState, ownKicks: ReadonlySet<number>): void {
  if (ownKicks.size === 0) return;
  const held: { b: Balloon; dir: DirCode }[] = [];
  for (const b of s.balloons) {
    if (b.slideDir === Dir.None || ownKicks.has(b.id)) continue;
    held.push({ b, dir: b.slideDir });
    b.slideDir = Dir.None;
  }
  slideBalloons(s, []);
  for (const { b, dir } of held) b.slideDir = dir;
}

/**
 * Where each of the local player's own sliding balloons should be drawn: `alpha` (0..1) of the
 * way toward where the next tick's slide puts it, stopping where the slide stops (the same lead
 * stepLead gives the critter). The world is left exactly as it was.
 */
export function slideLead(s: RoundState, ownKicks: ReadonlySet<number>, alpha: number): Map<number, LocalPosition> {
  const out = new Map<number, LocalPosition>();
  const sliding = s.balloons.filter((b) => b.slideDir !== Dir.None && ownKicks.has(b.id));
  if (sliding.length === 0) return out;
  const saved = sliding.map((b) => ({ b, x: b.x, y: b.y, tx: b.tx, ty: b.ty, slideDir: b.slideDir }));
  const k = Math.min(1, Math.max(0, alpha));
  if (!s.over && k > 0) slideOwnKicks(s, ownKicks);
  for (const o of saved) {
    out.set(o.b.id, { x: o.x + (o.b.x - o.x) * k, y: o.y + (o.b.y - o.y) * k });
    o.b.x = o.x;
    o.b.y = o.y;
    o.b.tx = o.tx;
    o.b.ty = o.ty;
    o.b.slideDir = o.slideDir;
  }
  return out;
}

/** Where the local player currently is (critter center, or duck on the border), null if absent. */
export function localPosition(s: RoundState, slot: number): LocalPosition | null {
  const p = s.players[slot];
  if (!p || !p.present) return null;
  if (!p.alive && p.duckPos >= 0) return duckXY(s.w, s.h, p.duckPos);
  return { x: p.x, y: p.y };
}

/** Sub-unit render offset of the local critter toward its next tick (see stepLead). */
export interface StepLead {
  dx: number;
  dy: number;
  moving: boolean;
}

/**
 * The input clock runs at 30 Hz but frames come at 60-144 Hz: drawing the critter only where
 * the last tick left it makes it hop every few frames. This returns the offset toward where the
 * next tick in `dir` will move it, scaled by `alpha` (0..1, the time elapsed toward that tick),
 * using the same movement code. The world is left exactly as it was.
 */
export function stepLead(s: RoundState, slot: number, dir: DirCode, alpha: number): StepLead {
  const p = s.players[slot];
  if (!p || !p.present || !p.alive || s.over || dir === Dir.None || alpha <= 0) return { dx: 0, dy: 0, moving: false };
  const { x, y, facing, moving } = p;
  movePlayer(s, p, dir, false);
  const k = Math.min(1, alpha);
  const lead = { dx: (p.x - x) * k, dy: (p.y - y) * k, moving: p.x !== x || p.y !== y };
  p.x = x;
  p.y = y;
  p.facing = facing;
  p.moving = moving;
  return lead;
}

/** Inputs the server has not acknowledged yet (seq > ack), oldest first. */
export function prunePending(pending: readonly PendingInput[], ack: number): PendingInput[] {
  return pending.filter((input) => input.seq > ack);
}

/** What one predicted client tick produced. */
export interface PredictedTick {
  /** Sequence number to send with the input. */
  seq: number;
  /** Balloon the local player kicked this tick, -1 if none. */
  kickedId: number;
}

export class LocalPredictor {
  private pending: PendingInput[] = [];
  /** Balloons the local player kicked that are still sliding (predicted or server-confirmed). */
  private readonly own = new Set<number>();

  constructor(
    readonly slot: number,
    private readonly nextSeq: () => number,
  ) {}

  /** Number of unacknowledged inputs currently kept for replay. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** The local player's own kicked balloons, advanced with every predicted tick. */
  get ownKicks(): ReadonlySet<number> {
    return this.own;
  }

  /** One client tick: moves the local player in `predicted` and remembers the input. */
  tick(predicted: RoundState, dir: DirCode): PredictedTick {
    const seq = this.nextSeq();
    const kickedId = applyLocalMove(predicted, this.slot, dir, this.own);
    this.pending.push({ seq, dir });
    if (this.pending.length > CONFIG.INPUT_BUFFER_TICKS) this.pending.shift();
    return { seq, kickedId };
  }

  /**
   * Rebuilds the predicted world from the authoritative one: drops inputs the server has applied
   * (seq <= ack) and replays the rest on a fresh copy. `auth` itself is never modified.
   * Own kicks the server shows still sliding keep being predicted; one it has not applied yet is
   * kicked again by the replayed input that made it.
   */
  reconcile(auth: RoundState, ack: number): RoundState {
    this.pending = prunePending(this.pending, ack);
    for (const id of this.own) {
      const b = auth.balloons.find((x) => x.id === id);
      if (!b || b.slideDir === Dir.None) this.own.delete(id);
    }
    const predicted = cloneState(auth);
    for (const input of this.pending) applyLocalMove(predicted, this.slot, input.dir, this.own);
    return predicted;
  }

  /** balloon_kicked from the server: the local player's kicks are predicted, nobody else's. */
  noteKick(id: number, slot: number): void {
    if (slot === this.slot) this.own.add(id);
    else this.own.delete(id);
  }

  /** Forget every pending input and kick (new round: nothing old may be replayed). */
  clear(): void {
    this.pending = [];
    this.own.clear();
  }
}

/** Monotonic input sequence source shared by every round of the page's lifetime. */
export function createSeqCounter(start = 0): () => number {
  let seq = start;
  return () => ++seq;
}

/** Corrections smaller than this are smoothed; bigger ones (respawns, lobs) snap. */
const SNAP_UNITS = CONFIG.SUB;
/** Exponential decay constant: ~95% of a correction is gone after 100 ms. */
const DECAY_TAU_MS = 100 / 3;
/** Offsets below this many sub-units are dropped (well under a pixel). */
const EPSILON_UNITS = 8;

/**
 * Render offset (sub-units) hiding reconciliation corrections: when a replay moves the local
 * player, the offset starts at old - new (so nothing visibly jumps) and decays toward zero.
 */
export class VisualError {
  x = 0;
  y = 0;

  /** Absorb a correction from `before` to `after`; returns true when it snapped instead. */
  absorb(before: LocalPosition | null, after: LocalPosition | null): boolean {
    if (!before || !after) {
      this.reset();
      return true;
    }
    const dx = this.x + before.x - after.x;
    const dy = this.y + before.y - after.y;
    if (Math.abs(dx) > SNAP_UNITS || Math.abs(dy) > SNAP_UNITS) {
      this.reset();
      return true;
    }
    this.x = dx;
    this.y = dy;
    return false;
  }

  /** Decay the offset by `dtMs` of elapsed render time. */
  decay(dtMs: number): void {
    const k = Math.exp(-Math.max(0, dtMs) / DECAY_TAU_MS);
    this.x *= k;
    this.y *= k;
    if (Math.abs(this.x) < EPSILON_UNITS) this.x = 0;
    if (Math.abs(this.y) < EPSILON_UNITS) this.y = 0;
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
  }
}
