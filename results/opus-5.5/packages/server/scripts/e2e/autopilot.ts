// Autopilot: plays a match for a headless client over the real protocol. It keeps a client-side
// RoundState exactly as a browser would (round_start grid + castle_washed events + snapshots) and
// answers every snapshot with enough inputs to keep `lead` of them queued on the server:
//   - 'hard' | 'medium' | 'easy': the real server bot brain (createBot) decides each tick, run on
//     the snapshot state advanced through the still-unapplied inputs (seq > ack), like the
//     client's rewind-replay prediction;
//   - 'tutorial': a new player following the lesson texts (LessonCoach over the Hard brain);
//   - 'suicide': drops a balloon on its own tile and stands still (finishes rounds fast);
//   - 'idle': sends nothing (an AFK player).
import {
  CONFIG,
  Dir,
  Tile,
  activeBalloonCount,
  applySnapshotToState,
  cloneState,
  createRoundState,
  decodeTiles,
  idx,
  simulateTick,
  type Difficulty,
  type GeneratedMap,
  type MatchConfig,
  type PlayerInput,
  type RoundState,
  type S2C,
  type SnapshotMsg,
} from '@splash/shared';
import { createBot } from '../../src/bots/bot';
import type { BotBrain } from '../../src/match/types';
import type { Msg, WsClient } from './client';
import { LessonCoach } from './lessons';

export type PilotKind = Difficulty | 'tutorial' | 'suicide' | 'idle';

export interface AutopilotStats {
  inputsSent: number;
  rounds: number;
  /** Snapshots whose ack matched a predicted tick: own position compared with the prediction. */
  predictionsChecked: number;
  /** ...of which the server's position differed (the client would have had to correct). */
  predictionsOff: number;
}

interface PendingInput {
  seq: number;
  input: PlayerInput;
  /** Tick the input was planned for and the own position predicted after it. */
  tick: number;
  x: number;
  y: number;
}

export class Autopilot {
  readonly stats: AutopilotStats = { inputsSent: 0, rounds: 0, predictionsChecked: 0, predictionsOff: 0 };
  private config: MatchConfig | null = null;
  private state: RoundState | null = null;
  private brain: BotBrain | null = null;
  private coach: LessonCoach | null = null;
  private pending: PendingInput[] = [];
  private seq = 0;
  private respondQueued = false;
  private readonly unsubscribe: () => void;

  /**
   * `lead`: inputs kept ahead of the server's acknowledgement (2 = one snapshot period of 30 Hz
   * ticks; more for a sped-up clock or artificial latency, see FlowContext.lead).
   */
  constructor(
    private readonly client: WsClient,
    private readonly kind: PilotKind,
    private readonly seed: number,
    private readonly lead = 2,
  ) {
    this.unsubscribe = client.onMessage((m) => this.onMessage(m));
  }

  stop(): void {
    this.unsubscribe();
    this.state = null;
  }

  private makeBrain(config: MatchConfig): BotBrain | null {
    this.coach = null;
    if (this.kind === 'suicide' || this.kind === 'idle') return null;
    if (this.kind !== 'tutorial') return createBot(config.yourSlot, this.kind, this.seed);
    this.coach = new LessonCoach(config.yourSlot, createBot(config.yourSlot, 'hard', this.seed));
    return this.coach;
  }

  private onMessage(m: S2C): void {
    switch (m.type) {
      case 'match_start':
        this.config = m.config;
        this.brain = this.makeBrain(m.config);
        this.state = null;
        return;
      case 'round_start':
        this.startRound(m);
        return;
      case 'event':
        this.applyEvents(m);
        return;
      case 'snapshot':
        this.applySnapshot(m);
        return;
      case 'tutorial_step':
        this.coach?.observe(m);
        return;
      case 'round_end':
      case 'match_end':
      case 'left_room':
        this.state = null;
        return;
      default:
        return;
    }
  }

  private startRound(m: Msg<'round_start'>): void {
    if (!this.config) return;
    const slots = Math.max(CONFIG.MODES[this.config.mode].maxPlayers, ...this.config.players.map((p) => p.slot + 1));
    const map: GeneratedMap = {
      w: m.w,
      h: m.h,
      tiles: decodeTiles(m.castleGrid),
      hidden: new Uint8Array(m.w * m.h),
      spawns: m.spawns.map((sp) => ({ slot: sp.slot, tx: sp.x, ty: sp.y })),
    };
    const present = Array.from({ length: slots }, (_, slot) => m.spawns.some((sp) => sp.slot === slot));
    this.state = createRoundState(map, present, this.config.rules);
    if (m.resumeTick !== undefined) this.state.tick = m.resumeTick;
    this.pending = [];
    this.brain?.reset();
    this.stats.rounds++;
  }

  /** Tiles only travel as events (snapshots carry the dynamic state). */
  private applyEvents(m: Msg<'event'>): void {
    const s = this.state;
    if (!s) return;
    for (const e of m.events) {
      if (e.type === 'castle_washed') s.tiles[idx(s.w, e.x, e.y)] = Tile.Floor;
    }
  }

  private applySnapshot(m: SnapshotMsg): void {
    const s = this.state;
    if (!s) return;
    applySnapshotToState(s, m);
    this.comparePrediction(m);
    this.pending = this.pending.filter((p) => p.seq > m.ack);
    // A burst of ticks delivers several snapshots at once: answer the newest one only.
    if (this.respondQueued) return;
    this.respondQueued = true;
    setImmediate(() => {
      this.respondQueued = false;
      this.respond();
    });
  }

  /**
   * When the server applied our input `ack` on exactly the tick it was planned for, our own
   * position must equal the prediction unless someone else interfered (a balloon in the way, a soak).
   */
  private comparePrediction(m: SnapshotMsg): void {
    const planned = this.pending.find((p) => p.seq === m.ack);
    const me = m.players.find((p) => p.slot === this.config?.yourSlot);
    if (!planned || planned.tick !== m.tick || !me?.alive) return;
    this.stats.predictionsChecked++;
    if (planned.x !== me.x || planned.y !== me.y) this.stats.predictionsOff++;
  }

  private respond(): void {
    const s = this.state;
    if (!s || !this.config || !this.client.isOpen) return;
    const me = s.players[this.config.yourSlot];
    if (!me?.present) return;
    if (this.kind === 'suicide') this.throwRound(s);
    else if (this.brain) this.pilot(s, this.brain);
  }

  /** Drop a balloon where we stand and wait for it (one press in flight at a time). */
  private throwRound(s: RoundState): void {
    const me = s.players[this.config!.yourSlot];
    if (!me.alive || this.pending.length > 0 || activeBalloonCount(s, me.slot) > 0) return;
    const input = this.sendInput(s.tick + 1, { seq: 0, dir: Dir.None, balloon: true });
    this.predict(input, s);
  }

  /** Prediction: replay the queued inputs on a copy, then let the brain decide the next ticks. */
  private pilot(s: RoundState, brain: BotBrain): void {
    const sim = cloneState(s);
    for (const p of this.pending) this.advance(sim, p.input);
    while (this.pending.length < this.lead) {
      const decided = brain.nextInput(sim);
      const input = this.sendInput(sim.tick + 1, decided);
      this.advance(sim, input);
      this.predict(input, sim);
    }
  }

  /** Records where we expect to stand after `input` (sim already advanced through it, or standing still). */
  private predict(input: PlayerInput, sim: RoundState): void {
    const pending = this.pending.find((p) => p.seq === input.seq);
    const me = sim.players[this.config!.yourSlot];
    if (pending && me) Object.assign(pending, { x: me.x, y: me.y });
  }

  private advance(sim: RoundState, input: PlayerInput): void {
    const slot = this.config!.yourSlot;
    simulateTick(sim, sim.players.map((p) => (p.slot === slot ? input : null)));
  }

  private sendInput(tick: number, decided: PlayerInput): PlayerInput {
    const input: PlayerInput = { seq: ++this.seq, dir: decided.dir, balloon: decided.balloon };
    this.pending.push({ seq: input.seq, input, tick, x: -1, y: -1 });
    this.client.send({ type: 'input', seq: input.seq, tick, dir: input.dir, balloonPressed: input.balloon });
    this.stats.inputsSent++;
    return input;
  }
}
