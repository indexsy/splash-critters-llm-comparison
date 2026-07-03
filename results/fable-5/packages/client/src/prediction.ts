// Client-side prediction for the LOCAL player plus interpolation buffers for
// remote entities. The local player runs the same shared movePlayer() the
// server runs; on each snapshot we rewind to the server's authoritative
// position and replay unacknowledged inputs.

import {
  CONFIG,
  TILE,
  movePlayer,
  type Dir,
  type PlayerInput,
  type SimPlayer,
  type SimState,
  type SnapshotData,
} from "@splash/shared";

interface BufferedSnapshot {
  data: SnapshotData;
  atMs: number;
}

export class GameNetState {
  w = 0;
  h = 0;
  grid: number[] = [];
  localSlot: number;
  snapshots: BufferedSnapshot[] = [];
  latest: SnapshotData | null = null;
  private history: PlayerInput[] = [];
  private mirror: SimState | null = null;
  private tickOffsetMs = 0; // serverTickTimeMs ≈ perfNow + offset… smoothed
  private offsetInit = false;
  seq = 0;
  /** Visual smoothing of reconciliation corrections. */
  private errX = 0;
  private errY = 0;

  constructor(localSlot: number) {
    this.localSlot = localSlot;
  }

  startRound(w: number, h: number, grid: number[], playerCount: number): void {
    this.w = w;
    this.h = h;
    this.grid = grid.slice();
    this.snapshots = [];
    this.latest = null;
    this.history = [];
    this.errX = 0;
    this.errY = 0;
    this.mirror = {
      mode: "ffa",
      w,
      h,
      tick: 0,
      grid: this.grid,
      contents: new Array(w * h).fill(null),
      players: Array.from({ length: playerCount }, (_, slot) => makeMirrorPlayer(slot)),
      balloons: [],
      splashes: [],
      powerups: [],
      tideRing: 0,
      tideNextTick: Infinity,
      nextBalloonId: 1,
      rules: { enableKick: CONFIG.ENABLE_KICK, revengeDucks: false },
      roundOver: false,
      winnerSlot: null,
    };
  }

  washCastle(x: number, y: number): void {
    this.grid[y * this.w + x] = TILE.EMPTY;
  }

  /** Estimated CURRENT server tick (float). */
  serverTickNow(): number {
    if (!this.latest) return 0;
    return this.latest.tick + ((performance.now() + this.tickOffsetMs - this.latestAtMs) * CONFIG.TICK_RATE) / 1000;
  }
  private latestAtMs = 0;

  /** Tick remote entities are rendered at (interpolation delay behind). */
  renderTick(): number {
    return this.serverTickNow() - (CONFIG.INTERP_DELAY_MS * CONFIG.TICK_RATE) / 1000;
  }

  onSnapshot(data: SnapshotData): void {
    const now = performance.now();
    this.snapshots.push({ data, atMs: now });
    while (this.snapshots.length > 40) this.snapshots.shift();
    this.latest = data;
    this.latestAtMs = now;
    if (!this.offsetInit) {
      this.tickOffsetMs = 0;
      this.offsetInit = true;
    }

    if (!this.mirror) return;
    // Mirror world state the local player collides with.
    this.mirror.tideRing = data.tideRing;
    this.mirror.balloons = data.balloons.map((b) => ({
      id: b.id,
      ownerSlot: b.ownerSlot,
      x: b.x,
      y: b.y,
      burstTick: b.burstTick,
      range: 1,
      placedTick: b.placedTick,
      ownerCanPass: b.ownerCanPass,
      slide: b.slideDir !== 0 ? { dir: b.slideDir, progress: b.slideProgress } : null,
      revenge: b.revenge,
    }));

    // Reconcile: adopt server position, replay unacked inputs.
    const me = data.players.find((p) => p.slot === this.localSlot);
    const mp = this.mirror.players[this.localSlot];
    if (!me || !mp) return;
    const beforeX = mp.x;
    const beforeY = mp.y;
    mp.speed = me.speed;
    mp.alive = me.alive;
    mp.hasKick = me.hasKick;
    if (!me.alive) return;
    mp.x = me.x;
    mp.y = me.y;
    this.history = this.history.filter((i) => i.seq > data.ackSeq);
    for (const input of this.history) {
      movePlayer(this.mirror, mp, input.dir, false);
    }
    // Keep the correction as a decaying visual offset (no teleport pops).
    this.errX = clampErr(beforeX + this.errX - mp.x);
    this.errY = clampErr(beforeY + this.errY - mp.y);
  }

  /** Apply one 30Hz input tick locally and remember it for replay. */
  applyLocalInput(dir: Dir, balloon: boolean): PlayerInput {
    const input: PlayerInput = { seq: ++this.seq, tick: Math.round(this.serverTickNow()), dir, balloon };
    if (this.mirror) {
      const mp = this.mirror.players[this.localSlot];
      if (mp.alive) movePlayer(this.mirror, mp, dir, false);
    }
    this.history.push(input);
    while (this.history.length > 45) this.history.shift();
    return input;
  }

  update(dt: number): void {
    // decay the visual error toward zero
    const decay = Math.pow(0.001, dt); // ~fully gone in 1s, mostly in 150ms
    this.errX *= decay;
    this.errY *= decay;
  }

  /** Predicted local player position (with smoothing offset). */
  localPos(): { x: number; y: number; dir: Dir; moving: boolean } | null {
    if (!this.mirror) return null;
    const mp = this.mirror.players[this.localSlot];
    if (!mp) return null;
    return { x: mp.x + this.errX, y: mp.y + this.errY, dir: mp.dir, moving: mp.moving };
  }

  /** Interpolated remote player state at renderTick. */
  remotePos(slot: number): { x: number; y: number; dir: Dir; moving: boolean } | null {
    const rt = this.renderTick();
    let a: BufferedSnapshot | null = null;
    let b: BufferedSnapshot | null = null;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const s = this.snapshots[i];
      if (s.data.tick <= rt) {
        a = s;
        b = this.snapshots[i + 1] ?? null;
        break;
      }
    }
    if (!a) a = this.snapshots[0] ?? null;
    if (!a) return null;
    const pa = a.data.players.find((p) => p.slot === slot);
    if (!pa) return null;
    if (!b) return { x: pa.x, y: pa.y, dir: pa.dir, moving: pa.moving };
    const pb = b.data.players.find((p) => p.slot === slot);
    if (!pb) return { x: pa.x, y: pa.y, dir: pa.dir, moving: pa.moving };
    const span = b.data.tick - a.data.tick;
    const f = span > 0 ? Math.max(0, Math.min(1, (rt - a.data.tick) / span)) : 1;
    return {
      x: pa.x + (pb.x - pa.x) * f,
      y: pa.y + (pb.y - pa.y) * f,
      dir: pb.dir,
      moving: pb.moving,
    };
  }
}

function clampErr(v: number): number {
  // Big errors (teleports, round resets) snap instead of gliding.
  return Math.abs(v) > 1.5 ? 0 : v;
}

function makeMirrorPlayer(slot: number): SimPlayer {
  return {
    id: String(slot),
    slot,
    x: 1.5,
    y: 1.5,
    dir: 3,
    moving: false,
    alive: true,
    soakedTick: -1,
    speed: CONFIG.SPEED_BASE,
    balloonCount: CONFIG.BALLOON_BASE,
    splashRange: CONFIG.RANGE_BASE,
    hasKick: false,
    bootsCollected: false,
    balloonsActive: 0,
    dropHeld: false,
    duck: null,
    soaks: 0,
    revengeSoaks: 0,
    castles: 0,
  };
}
