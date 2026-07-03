import {
  CONFIG,
  createSimState,
  generateMap,
  simulateTick,
  type BotDifficulty,
  type GameMode,
  type MapTheme,
  type MatchEndPlayer,
  type MatchPlayerInfo,
  type PlayerInput,
  type S2C,
  type SimRules,
  type SimState,
  type SnapshotData,
  tierForRating,
} from "../../shared/src/index.js";
import { BotController } from "./bots/bot.js";
import { finalizeMatch } from "./results.js";

/** Anything that can receive server messages (net.ts Conn satisfies this). */
export interface Sender {
  send(msg: S2C): void;
}

/** Live match per human player id — reconnects route through this. */
export const activeMatchByPlayer = new Map<string, Match>();

export interface SeatSpec {
  playerId: string;
  nickname: string;
  animal: string;
  hat: string;
  isBot: boolean;
  difficulty?: BotDifficulty;
  conn: Sender | null;
  rating?: number;
}

export interface Seat extends SeatSpec {
  slot: number;
  bot: BotController | null;
  convertedToBot: boolean;
  disconnectedAtMs: number | null;
  forfeited: boolean;
  roundsWon: number;
  totalSoaks: number;
  totalRevengeSoaks: number;
  totalCastles: number;
  biggestChain: number;
  survivedTicks: number;
  inputQueue: PlayerInput[];
  lastInput: PlayerInput | null;
  ackSeq: number;
}

export interface MatchOpts {
  mode: GameMode;
  ranked: boolean;
  roundsToWin: number;
  theme: MapTheme;
  seats: SeatSpec[];
  onEnd: (match: Match) => void;
}

type Phase = "intro" | "live" | "round_end" | "done";

export class Match {
  readonly mode: GameMode;
  readonly ranked: boolean;
  readonly roundsToWin: number;
  readonly theme: MapTheme;
  readonly seats: Seat[];
  readonly rules: SimRules;
  readonly startedAt = Date.now();
  state!: SimState;
  roundNo = 0;
  phase: Phase = "intro";
  private phaseTicksLeft = 0;
  private onEnd: (m: Match) => void;
  private snapshotToggle = false;

  constructor(opts: MatchOpts) {
    this.mode = opts.mode;
    this.ranked = opts.ranked;
    this.roundsToWin = opts.roundsToWin;
    this.theme = opts.theme;
    this.onEnd = opts.onEnd;
    this.rules = {
      enableKick: CONFIG.ENABLE_KICK,
      revengeDucks: opts.ranked ? CONFIG.REVENGE_DUCKS_IN_RANKED : CONFIG.ENABLE_REVENGE_DUCKS,
    };
    this.seats = opts.seats.map((s, slot) => ({
      ...s,
      slot,
      bot: s.isBot ? new BotController(slot, s.difficulty ?? "medium", Date.now() % 100000) : null,
      convertedToBot: false,
      // A human seat starting without a live connection (e.g. rematch voted
      // while someone's tab was closed) goes straight onto the grace clock.
      disconnectedAtMs: !s.isBot && s.conn === null ? Date.now() : null,
      forfeited: false,
      roundsWon: 0,
      totalSoaks: 0,
      totalRevengeSoaks: 0,
      totalCastles: 0,
      biggestChain: 0,
      survivedTicks: 0,
      inputQueue: [],
      lastInput: null,
      ackSeq: 0,
    }));
    for (const s of this.seats) {
      if (!s.isBot) activeMatchByPlayer.set(s.playerId, this);
    }
  }

  playerInfos(): MatchPlayerInfo[] {
    return this.seats.map((s) => ({
      slot: s.slot,
      playerId: s.playerId,
      nickname: s.nickname,
      animal: s.animal,
      hat: s.hat,
      isBot: s.isBot,
      difficulty: s.isBot ? s.difficulty : undefined,
      rating: this.ranked ? s.rating : undefined,
      tier: this.ranked && s.rating !== undefined ? tierForRating(s.rating) : undefined,
    }));
  }

  start(): void {
    for (const s of this.seats) this.sendMatchStart(s);
    this.startRound();
  }

  private sendMatchStart(seat: Seat): void {
    seat.conn?.send({
      t: "match_start",
      mode: this.mode,
      ranked: this.ranked,
      roundsToWin: this.roundsToWin,
      theme: this.theme,
      players: this.playerInfos(),
      yourSlot: seat.slot,
      rules: this.rules,
    });
  }

  private startRound(): void {
    this.roundNo++;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const map = generateMap(this.mode, seed);
    this.state = createSimState(
      this.mode,
      map,
      this.seats.map((s) => s.playerId),
      this.rules
    );
    // Forfeited seats never contend again.
    for (const s of this.seats) {
      if (s.forfeited) {
        this.state.players[s.slot].alive = false;
        this.state.players[s.slot].soakedTick = 0;
        this.state.players[s.slot].duck = null;
      }
    }
    this.phase = "intro";
    this.phaseTicksLeft = CONFIG.ROUND_INTRO_TICKS;
    this.broadcast({
      t: "round_start",
      roundNo: this.roundNo,
      // Cosmetic-only seed: an INDEPENDENT random value, so hidden power-up
      // contents can never be derived client-side from the real sim seed.
      mapSeed: Math.floor(Math.random() * 0x7fffffff),
      castleGrid: this.state.grid,
      w: this.state.w,
      h: this.state.h,
      theme: this.theme,
      startTick: this.state.tick,
      introTicks: CONFIG.ROUND_INTRO_TICKS,
      scores: this.seats.map((s) => s.roundsWon),
    });
    this.broadcastSnapshot();
  }

  handleInput(playerId: string, input: PlayerInput): void {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat || seat.isBot) return;
    if (seat.lastInput && input.seq <= seat.lastInput.seq && seat.inputQueue.length === 0) return;
    seat.inputQueue.push(input);
    while (seat.inputQueue.length > 8) seat.inputQueue.shift();
  }

  handleDisconnect(playerId: string): void {
    const seat = this.seats.find((s) => s.playerId === playerId && !s.isBot);
    if (!seat || this.phase === "done") return;
    seat.conn = null;
    seat.disconnectedAtMs = Date.now();
    this.broadcast({ t: "player_conn", slot: seat.slot, connected: false, becameBot: false });
  }

  /** Reconnect (or casual re-takeover from the substitute bot). */
  handleReconnect(playerId: string, conn: Sender): boolean {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat || this.phase === "done" || seat.forfeited) return false;
    seat.conn = conn;
    seat.disconnectedAtMs = null;
    // The reconnected client restarts its input sequence from 1.
    seat.lastInput = null;
    seat.inputQueue = [];
    seat.ackSeq = 0;
    if (seat.convertedToBot) {
      seat.convertedToBot = false;
      seat.isBot = false;
      seat.bot = null;
    }
    this.sendMatchStart(seat);
    seat.conn.send({
      t: "round_start",
      roundNo: this.roundNo,
      mapSeed: Math.floor(Math.random() * 0x7fffffff),
      castleGrid: this.state.grid,
      w: this.state.w,
      h: this.state.h,
      theme: this.theme,
      startTick: this.state.tick,
      introTicks: this.phase === "intro" ? this.phaseTicksLeft : 0,
      scores: this.seats.map((s) => s.roundsWon),
    });
    this.broadcast({ t: "player_conn", slot: seat.slot, connected: true, becameBot: false });
    return true;
  }

  broadcast(msg: S2C): void {
    for (const s of this.seats) s.conn?.send(msg);
  }

  /** One 30Hz step. */
  tick(): void {
    if (this.phase === "done") return;
    this.checkDisconnectGraces();
    if (this.phase === "intro") {
      this.phaseTicksLeft--;
      if (this.phaseTicksLeft <= 0) this.phase = "live";
      this.broadcastSnapshotMaybe();
      return;
    }
    if (this.phase === "round_end") {
      this.phaseTicksLeft--;
      if (this.phaseTicksLeft <= 0) {
        const champion = this.seats.find((s) => s.roundsWon >= this.roundsToWin);
        if (champion || this.roundNo >= CONFIG.MAX_ROUNDS) this.endMatch();
        else this.startRound();
      }
      return;
    }

    // live: gather inputs
    const inputs: (PlayerInput | null)[] = this.seats.map((seat) => {
      if (seat.forfeited) return null;
      if (seat.bot) return seat.bot.update(this.state);
      // Drain backlog gently, then consume one input this tick.
      while (seat.inputQueue.length > 4) seat.inputQueue.shift();
      const next = seat.inputQueue.shift();
      if (next) {
        seat.lastInput = next;
        seat.ackSeq = next.seq;
        return next;
      }
      // Hold last direction between packets (30Hz send vs 30Hz sim jitter).
      return seat.lastInput;
    });

    const events = simulateTick(this.state, inputs);

    for (const ev of events) {
      if (ev.t === "chain_burst" && ev.slot >= 0 && ev.slot < this.seats.length) {
        const seat = this.seats[ev.slot];
        seat.biggestChain = Math.max(seat.biggestChain, ev.size);
      }
      if (ev.t === "player_soaked") {
        this.seats[ev.slot].survivedTicks += this.state.tick;
      }
    }
    if (events.length > 0) this.broadcast({ t: "events", tick: this.state.tick, events });
    this.broadcastSnapshotMaybe();

    if (this.state.roundOver) {
      this.finishRound();
    }
  }

  private finishRound(): void {
    const winnerSlot = this.state.winnerSlot ?? -1;
    for (const p of this.state.players) {
      if (p.alive) this.seats[p.slot].survivedTicks += this.state.tick;
      this.seats[p.slot].totalSoaks += p.soaks;
      this.seats[p.slot].totalRevengeSoaks += p.revengeSoaks;
      this.seats[p.slot].totalCastles += p.castles;
    }
    if (winnerSlot >= 0) this.seats[winnerSlot].roundsWon++;
    this.broadcast({
      t: "round_end",
      winnerSlot,
      draw: winnerSlot < 0,
      scores: this.seats.map((s) => s.roundsWon),
    });
    this.phase = "round_end";
    this.phaseTicksLeft = CONFIG.ROUND_END_PAUSE_TICKS;
  }

  private checkDisconnectGraces(): void {
    const now = Date.now();
    for (const seat of this.seats) {
      if (seat.isBot || seat.conn || seat.disconnectedAtMs === null || seat.forfeited) continue;
      if (now - seat.disconnectedAtMs < CONFIG.RECONNECT_GRACE_MS) continue;
      if (this.ranked) {
        // Forfeit: no bot substitution in ranked.
        seat.forfeited = true;
        const alive = this.state.players[seat.slot];
        if (alive) {
          alive.alive = false;
          alive.duck = null;
        }
        const remaining = this.seats.filter((s) => !s.forfeited);
        if (remaining.length <= 1 || this.mode === "duel") {
          for (const r of remaining) {
            if (this.mode === "duel") r.roundsWon = Math.max(r.roundsWon, this.roundsToWin);
          }
          this.endMatch();
          return;
        }
      } else {
        // Casual: convert to a Medium bot; the human may still reconnect.
        seat.convertedToBot = true;
        seat.isBot = true;
        seat.difficulty = "medium";
        seat.bot = new BotController(seat.slot, "medium", Date.now() % 100000);
        seat.disconnectedAtMs = null;
        this.broadcast({ t: "player_conn", slot: seat.slot, connected: false, becameBot: true });
      }
    }
  }

  endMatch(): void {
    if (this.phase === "done") return;
    this.phase = "done";
    for (const s of this.seats) {
      if (activeMatchByPlayer.get(s.playerId) === this) activeMatchByPlayer.delete(s.playerId);
    }
    const { players, awards } = finalizeMatch(this);
    this.broadcast({
      t: "match_end",
      ranked: this.ranked,
      players,
      awards,
      rematchAvailable: !this.ranked,
    });
    this.onEnd(this);
  }

  buildSnapshot(): Omit<SnapshotData, "ackSeq"> {
    return {
      tick: this.state.tick,
      serverTimeMs: Date.now(),
      players: this.state.players.map((p) => ({
        slot: p.slot,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        dir: p.dir,
        moving: p.moving,
        alive: p.alive,
        speed: p.speed,
        balloonCount: p.balloonCount,
        splashRange: p.splashRange,
        hasKick: p.hasKick,
        soaks: p.soaks,
        duckPos: p.duck ? Math.round(p.duck.pos * 10) / 10 : null,
      })),
      balloons: this.state.balloons.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        burstTick: b.burstTick,
        placedTick: b.placedTick,
        slideDir: b.slide?.dir ?? 0,
        slideProgress: b.slide?.progress ?? 0,
        revenge: b.revenge,
        ownerSlot: b.ownerSlot,
        ownerCanPass: b.ownerCanPass,
      })),
      splashes: this.state.splashes.map((s) => ({ x: s.x, y: s.y, endTick: s.endTick })),
      powerups: this.state.powerups.map((u) => ({ x: u.x, y: u.y, type: u.type })),
      tideRing: this.state.tideRing,
    };
  }

  private broadcastSnapshotMaybe(): void {
    this.snapshotToggle = !this.snapshotToggle;
    if (this.snapshotToggle) this.broadcastSnapshot(); // 15Hz of the 30Hz loop
  }

  private broadcastSnapshot(): void {
    const base = this.buildSnapshot();
    for (const seat of this.seats) {
      seat.conn?.send({ t: "snapshot", data: { ...base, ackSeq: seat.ackSeq } });
    }
  }
}

/** Global 30Hz driver for every live match, with catch-up accumulator. */
export class GameLoop {
  private matches = new Set<Match>();
  private timer: NodeJS.Timeout | null = null;
  private lastMs = Date.now();
  private acc = 0;

  add(match: Match): void {
    this.matches.add(match);
    match.start();
    if (!this.timer) {
      this.lastMs = Date.now();
      this.acc = 0;
      this.timer = setInterval(() => this.pump(), 1000 / CONFIG.TICK_RATE / 2);
    }
  }

  remove(match: Match): void {
    this.matches.delete(match);
    if (this.matches.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private pump(): void {
    const now = Date.now();
    this.acc += now - this.lastMs;
    this.lastMs = now;
    const step = 1000 / CONFIG.TICK_RATE;
    let steps = 0;
    while (this.acc >= step && steps < 5) {
      this.acc -= step;
      steps++;
      for (const m of [...this.matches]) {
        m.tick();
        if (m.phase === "done") this.matches.delete(m);
      }
    }
    if (this.acc > 500) this.acc = 0; // huge stall: drop debt instead of spiraling
  }
}

export const gameLoop = new GameLoop();
