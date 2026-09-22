import {
  CONFIG,
  Dir,
  Tile,
  decodeGrid,
  edgeDist,
  makePlayer,
  simulateTick,
  type Dir as DirId,
  type GameState,
  type PlayerInput,
  type PublicPlayer,
  type RoundStartMsg,
  type SimEvent,
  type SnapshotMsg,
} from '@splash/shared';

export class Predictor {
  state: GameState | null = null;
  tiles: number[] = [];
  pending: PlayerInput[] = [];
  seq = 0;
  myId = '';
  w = 0;
  h = 0;

  reset(round: RoundStartMsg, players: PublicPlayer[], myId: string, mode: 'duel' | 'ffa', rounds: number) {
    this.myId = myId;
    this.w = round.width;
    this.h = round.height;
    this.tiles = decodeGrid(round.castleGrid);
    this.seq = 0;
    this.pending = [];
    this.state = {
      tick: 0,
      phase: 'playing',
      mode,
      theme: round.theme,
      width: round.width,
      height: round.height,
      tiles: this.tiles.slice(),
      hidden: this.tiles.map(() => null),
      players: players.map((p) => {
        const sp = round.spawns.find((s) => s.id === p.id) ?? { x: 1, y: 1 };
        return makePlayer({
          id: p.id,
          name: p.name,
          slot: p.slot,
          animal: p.animal,
          hat: p.hat,
          x: sp.x + 0.5,
          y: sp.y + 0.5,
          isBot: p.isBot,
          facing: (p.slot % 2 === 0 ? Dir.Right : Dir.Left) as DirId,
        });
      }),
      balloons: [],
      splashes: [],
      powerups: [],
      tideRing: 0,
      warmup: CONFIG.WARMUP_TICKS,
      revenge: false,
      roundsToWin: rounds,
      winnerId: null,
      draw: false,
      over: false,
      events: [],
    };
  }

  step(dir: number, balloon: boolean): PlayerInput | null {
    if (!this.state || this.state.over) return null;
    this.seq += 1;
    const inp: PlayerInput = { seq: this.seq, tick: this.state.tick, dir: dir as DirId, balloon };
    this.pending.push(inp);
    if (this.pending.length > 48) this.pending.shift();
    simulateTick(this.state, { [this.myId]: inp });
    return inp;
  }

  applyEvent(ev: SimEvent) {
    if (!this.w) return;
    if (ev.type === 'castle_washed') {
      const i = ev.y * this.w + ev.x;
      if (i >= 0 && i < this.tiles.length && this.tiles[i] !== Tile.Boulder) {
        this.tiles[i] = ev.by === 'tide' ? Tile.Flood : Tile.Empty;
      }
    } else if (ev.type === 'tide_advance') this.flood(ev.ring);
  }

  flood(ring: number) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (edgeDist(x, y, this.w, this.h) > ring) continue;
        const i = y * this.w + x;
        if (this.tiles[i] === Tile.Boulder) continue;
        this.tiles[i] = Tile.Flood;
      }
    }
  }

  reconcile(snap: SnapshotMsg) {
    if (!this.state) return;
    const ack = snap.acks[this.myId] ?? 0;
    this.pending = this.pending.filter((i) => i.seq > ack);
    if (snap.tideRing > 0) this.flood(snap.tideRing);
    const next = structuredClone(this.state);
    next.tiles = this.tiles.slice();
    next.hidden = next.tiles.map(() => null);
    next.tick = snap.tick;
    next.warmup = snap.warmup;
    next.tideRing = snap.tideRing;
    next.phase = snap.phase;
    next.over = snap.phase === 'round_end';
    next.winnerId = snap.winnerId;
    next.draw = snap.draw;
    next.events = [];
    next.balloons = snap.balloons.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      ownerId: b.ownerId,
      fuse: b.fuse,
      range: b.range,
      sliding: b.sliding,
      slideDir: b.slideDir as DirId,
      slideAcc: b.slideAcc,
      born: snap.tick - 1,
      revenge: b.revenge,
    }));
    next.splashes = snap.splashes.map((s) => ({ ...s }));
    next.powerups = snap.powerups.map((u) => ({ ...u }));
    for (const sp of snap.players) {
      let p = next.players.find((x) => x.id === sp.id);
      if (!p) {
        p = makePlayer({ id: sp.id, name: sp.name, x: sp.x, y: sp.y, slot: next.players.length, animal: sp.animal, hat: sp.hat });
        next.players.push(p);
      }
      p.x = sp.x;
      p.y = sp.y;
      p.facing = sp.facing as DirId;
      p.alive = sp.alive;
      p.speed = sp.speed;
      p.balloonCount = sp.balloonCount;
      p.splashRange = sp.splashRange;
      p.hasKick = sp.hasKick;
      p.flippers = sp.flippers;
      p.roundWins = sp.roundWins;
      p.soaks = sp.soaks;
      p.revengeSoaks = sp.revengeSoaks;
      p.castles = sp.castles;
      p.biggestChain = sp.biggestChain;
      p.ducking = sp.ducking;
      p.duckT = sp.duckT;
      p.duckCooldown = sp.duckCooldown;
      p.longestLife = sp.longestLife;
      p.survivedTicks = sp.survivedTicks;
      p.name = sp.name;
      p.animal = sp.animal;
      p.hat = sp.hat;
      p.isBot = sp.isBot;
    }
    for (const inp of this.pending) simulateTick(next, { [this.myId]: inp });
    this.state = next;
  }
}

export class Interp {
  samples: SnapshotMsg[] = [];
  push(s: SnapshotMsg) {
    this.samples.push(s);
    if (this.samples.length > 40) this.samples.shift();
  }
  clear() { this.samples = []; }
  at(serverNow: number): { a: SnapshotMsg; b: SnapshotMsg; u: number } | null {
    const s = this.samples;
    if (!s.length) return null;
    const t = serverNow - CONFIG.INTERP_DELAY_MS;
    if (t <= s[0].serverTime) return { a: s[0], b: s[0], u: 0 };
    const last = s[s.length - 1];
    if (t >= last.serverTime) return { a: last, b: last, u: 0 };
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].serverTime <= t && s[i + 1].serverTime >= t) {
        const span = s[i + 1].serverTime - s[i].serverTime || 1;
        return { a: s[i], b: s[i + 1], u: (t - s[i].serverTime) / span };
      }
    }
    return { a: last, b: last, u: 0 };
  }
}

let clockOffset = 0;
export function notePing(serverTime: number, rtt: number) {
  clockOffset = serverTime - Date.now() + rtt / 2;
}
export function serverNow(): number {
  return Date.now() + clockOffset;
}
