import {
  CONFIG,
  Dir,
  GameState,
  InputFrame,
  Snapshot,
  TILE_CASTLE,
  createGame,
  simulateTick,
} from '@splash/shared';

const MAX_BUFFER = 60;

export class PredictedGame {
  state: GameState | null = null;
  mySlot = 0;
  private inputBuffer: InputFrame[] = [];
  private seq = 0;
  castleGridBase: number[] = [];
  snapshots: { s: Snapshot; recvAt: number }[] = [];
  estTickRate = CONFIG.TICK_RATE;

  initRound(mySlot: number, mode: 'duel' | 'ffa', playerCount: number, mapSeed: number, castleGrid: number[], roundsToWin: number, enableRevengeDucks: boolean): void {
    this.mySlot = mySlot;
    this.inputBuffer = [];
    this.snapshots = [];
    if (castleGrid.length > 0) this.castleGridBase = castleGrid;
    this.state = createGame({
      mode,
      mapSeed,
      playerCount,
      roundsToWin,
      enableRevengeDucks,
    });
    if (this.castleGridBase.length === this.state.tiles.length) {
      this.state.tiles = [...this.castleGridBase];
      this.state.castleContents = new Map();
    }
  }

  nextInput(dir: Dir, balloon: boolean): InputFrame {
    return { seq: ++this.seq, dir, balloon };
  }

  pushInput(frame: InputFrame): void {
    if (!this.state) return;
    this.inputBuffer.push(frame);
    if (this.inputBuffer.length > MAX_BUFFER) this.inputBuffer.shift();
    const inputs = new Map<number, InputFrame>();
    inputs.set(this.mySlot, frame);
    simulateTick(this.state, inputs);
  }

  applySnapshot(s: Snapshot): void {
    this.snapshots.push({ s, recvAt: performance.now() });
    if (this.snapshots.length > 4) this.snapshots.shift();
    if (!this.state) return;
    if (s.roundNo !== this.state.roundNo) return;
    const st = this.state;
    st.tick = s.tick;
    st.phase = s.phase;
    st.tideRing = s.tideRing;
    st.countdownUntilTick = s.countdownUntilTick;
    st.roundWinner = s.roundWinner;
    st.matchWinner = s.matchWinner;

    if (this.castleGridBase.length === st.tiles.length) {
      const destroyed = new Set(s.destroyedCastles);
      for (let i = 0; i < st.tiles.length; i++) {
        if (destroyed.has(i)) st.tiles[i] = 0;
        else if (this.castleGridBase[i] === TILE_CASTLE) st.tiles[i] = TILE_CASTLE;
      }
    }

    for (const sp of s.players) {
      const p = st.players[sp.slot];
      if (!p) continue;
      p.x = sp.x;
      p.y = sp.y;
      p.alive = sp.alive;
      p.dir = sp.dir;
      p.speed = sp.speed;
      p.balloonCount = sp.balloonCount;
      p.splashRange = sp.splashRange;
      p.hasBoots = sp.hasBoots;
      p.roundWins = sp.roundWins;
      p.soaks = sp.soaks;
      p.castlesWashed = sp.castlesWashed;
      p.isDuck = sp.isDuck;
      p.duckPos = sp.duckPos;
      p.emoteId = sp.emoteId;
      p.emoteUntilTick = sp.emoteUntilTick;
    }

    st.balloons = s.balloons.map((b) => ({
      id: b.id,
      ownerSlot: b.ownerSlot,
      tx: b.tx,
      ty: b.ty,
      fx: b.fx,
      fy: b.fy,
      slideDir: b.slideDir,
      placedTick: b.burstTick - CONFIG.FUSE_TICKS,
      burstTick: b.burstTick,
      flying: b.flying,
      flyDir: 0,
      flyTilesLeft: 0,
    }));

    st.splashes = s.splashes.map((sp) => ({ tiles: sp.tiles, untilTick: sp.untilTick, ownerSlot: -1, depth: 0, group: -1 }));
    st.exposedPowerUps = s.powerups.map((p) => ({ ...p }));

    const me = s.players[this.mySlot];
    const acked = me?.lastInputSeq ?? 0;
    this.inputBuffer = this.inputBuffer.filter((f) => f.seq > acked);
    for (const frame of this.inputBuffer) {
      const inputs = new Map<number, InputFrame>();
      inputs.set(this.mySlot, frame);
      simulateTick(st, inputs);
    }
    st.events = [];
  }

  remoteInterp(slot: number): { x: number; y: number } | null {
    if (this.snapshots.length === 0) return null;
    const latest = this.snapshots[this.snapshots.length - 1]!;
    const a = latest.s.players[slot];
    if (!a) return null;
    if (this.snapshots.length < 2) return { x: a.x, y: a.y };
    const prev = this.snapshots[this.snapshots.length - 2]!;
    const b = prev.s.players[slot];
    if (!b) return { x: a.x, y: a.y };
    const span = latest.recvAt - prev.recvAt;
    const t = span > 0 ? Math.min(1.5, Math.max(0, (performance.now() - CONFIG.INTERP_DELAY_MS - prev.recvAt) / span)) : 1;
    return { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
  }

  estimatedServerTick(): number {
    if (this.snapshots.length === 0) return this.state?.tick ?? 0;
    const latest = this.snapshots[this.snapshots.length - 1]!;
    return latest.s.tick + (performance.now() - latest.recvAt) / (1000 / this.estTickRate);
  }
}
