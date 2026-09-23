// Client-side state of one match: config, the current round's authoritative and predicted
// worlds, the local predictor, the remote interpolation buffer and the tick estimate. No DOM,
// no network: the session feeds it server messages and input, the renderer reads a Scene.
import {
  CONFIG,
  Dir,
  Tile,
  activeBalloonCount,
  applySnapshotToState,
  balloonAt,
  idx,
  isFlooded,
  tileCenter,
  tileOf,
  toPlayerSnap,
  type DirCode,
  type GameEvent,
  type MatchConfig,
  type PlacementEntry,
  type RoundEndMsg,
  type RoundStartMsg,
  type RoundState,
  type SnapshotMsg,
} from '@splash/shared';
import { LocalPredictor, VisualError, localPosition, slideLead, stepLead, type LocalPosition } from '../prediction';
import { TickEstimator, isGoWindow, isRoundLive, roundStartAnchor } from './clock';
import type { InputGate } from './inputPacer';
import { InterpClock, SnapshotBuffer, interpolatePlayers, type InterpolatedPlayer, type TimedSnapshot } from './interpolation';
import { RemoteEventHold, type HeldEvent } from './remoteHold';
import type { ActorView, GhostDrop, MatchPhase, RoundInfo, RoundResult, SlotStatus } from './scene';
import { verdictFromPlacements, verdictFromScores } from './verdict';
import { applyWorldEvent, buildRoundWorld, isShowdown, leaveRound, presentCount, syncPresence } from './world';

/** A predicted drop is shown at most this long when the server never confirms it. */
const GHOST_MAX_MS = 900;

/** What one snapshot did to the local prediction. */
export interface Reconciliation {
  /** How far the replayed prediction moved from the one on screen (sub-units), null if absent. */
  correctionUnits: number | null;
  /** True when the correction was too large to smooth and snapped. */
  snapped: boolean;
  /** Inputs still awaiting the server's ack after this snapshot. */
  pending: number;
}

/** Where the local player's next input tick is heading and how far along it is (0..1). */
export interface LocalLead {
  dir: DirCode;
  alpha: number;
}

const NO_LEAD: LocalLead = { dir: Dir.None, alpha: 0 };

/** A held event now due; a soak comes with where its critter is drawn at the soak (sub-units). */
export interface DueEvent extends HeldEvent {
  at: { x: number; y: number } | null;
}

export interface LocalInput {
  seq: number;
  /** Estimated server tick the input was produced for. */
  tick: number;
  dir: DirCode;
  balloonPressed: boolean;
}

export class MatchState {
  config: MatchConfig | null = null;
  introStartMs = 0;
  round: RoundInfo | null = null;
  /** Server truth: snapshots + events. */
  auth: RoundState | null = null;
  /** auth + the local player's unacknowledged inputs replayed on top. */
  predicted: RoundState | null = null;
  result: RoundResult | null = null;
  scores: number[] = [];
  pings: number[] = [];
  readonly status = new Map<number, SlotStatus>();
  readonly error = new VisualError();
  private predictor: LocalPredictor | null = null;
  private readonly buffer = new SnapshotBuffer();
  private readonly interp = new InterpClock();
  private readonly ticks = new TickEstimator();
  private lastSnapshotTick = -1;
  private drops: GhostDrop[] = [];
  private readonly lastDrawn = new Map<number, { x: number; y: number }>();
  /** Own kicks whose sound played when predicted, by balloon id (their server echo stays silent). */
  private readonly kicksHeard = new Map<number, number>();
  private kickSoundDue = false;
  private readonly held = new RemoteEventHold();

  constructor(private readonly nextSeq: () => number) {}

  get mySlot(): number {
    return this.config?.yourSlot ?? -1;
  }

  get ghostDrops(): readonly GhostDrop[] {
    return this.drops;
  }

  /** match_start: a new match (or the same one re-sent on a reconnect). */
  startMatch(config: MatchConfig, nowMs: number): void {
    const sameMatch = this.config?.matchId === config.matchId;
    this.config = config;
    this.predictor = new LocalPredictor(config.yourSlot, this.nextSeq);
    if (sameMatch) {
      // A re-sync after a reconnect: the server re-sends the status of every seat still offline,
      // bot-played or forfeited, but nobody told us about seats that came back while we were
      // away. Forfeits and bot take-overs are for good, so only those are kept.
      for (const [slot, st] of this.status) if (!st.forfeited && !st.replacedByBot) this.status.delete(slot);
      return;
    }
    this.introStartMs = nowMs;
    this.round = null;
    this.auth = null;
    this.predicted = null;
    this.result = null;
    this.scores = config.players.map(() => 0);
    this.status.clear();
  }

  /**
   * round_start: fresh worlds. A resumeTick above 0 re-attaches mid-round with no countdown; a
   * re-sync during the 3-2-1 (resumeTick 0) plays the rest of the countdown.
   */
  startRound(rs: RoundStartMsg, serverNow: number): void {
    const config = this.config;
    if (!config) return;
    const forfeited = this.forfeitedSlots();
    this.auth = buildRoundWorld(config, rs, forfeited);
    this.predicted = buildRoundWorld(config, rs, forfeited);
    const { anchor, resumed } = roundStartAnchor(rs, serverNow);
    const contenders = presentCount(this.predicted);
    this.round = { roundNo: rs.roundNo, theme: rs.theme, mapSeed: rs.mapSeed, startTime: rs.startTime, tideStartTick: rs.tideStartTick, resumed, contenders };
    this.result = null;
    this.scores = [...rs.scores];
    this.predictor?.clear();
    this.buffer.clear();
    // The first snapshot (tick 2) blends remote critters away from their spawns instead of popping
    // them there and holding them until the render clock catches up. A mid-round re-join only
    // knows where everyone is from its first snapshot.
    if (!resumed) this.buffer.push(spawnLayout(this.auth, rs.startTime));
    this.interp.reset();
    this.error.reset();
    this.drops = [];
    this.lastDrawn.clear();
    this.kicksHeard.clear();
    this.kickSoundDue = false;
    this.held.clear();
    this.lastSnapshotTick = -1;
    this.ticks.reset(anchor);
  }

  /**
   * snapshot: authoritative update, rewind-replay of the local player, interpolation sample.
   * Returns the reconciliation outcome (null when the snapshot was stale or no round is running).
   */
  applySnapshot(snap: SnapshotMsg, serverNow: number): Reconciliation | null {
    const auth = this.auth;
    const predictor = this.predictor;
    if (!auth || !predictor || snap.tick < this.lastSnapshotTick) return null;
    // A round re-joined mid-way starts from the spawn tiles: its first snapshot places everyone
    // where they really are, which is a jump to take at once, not a correction to smooth.
    const placing = this.lastSnapshotTick < 0 && this.round?.resumed === true;
    this.lastSnapshotTick = snap.tick;
    const before = this.predicted && !placing ? localPosition(this.predicted, predictor.slot) : null;
    syncPresence(auth, new Set(snap.players.map((ps) => ps.slot)));
    applySnapshotToState(auth, snap);
    this.predicted = predictor.reconcile(auth, snap.ack);
    const after = localPosition(this.predicted, predictor.slot);
    const snapped = this.error.absorb(before, after) && !placing;
    this.buffer.push({ serverTime: snap.serverTime, tick: snap.tick, players: snap.players });
    this.interp.observe(snap.serverTime, serverNow);
    this.ticks.observe({ tick: snap.tick, serverTime: snap.serverTime });
    this.pings = [...snap.pings];
    const correctionUnits = before && after ? Math.hypot(after.x - before.x, after.y - before.y) : null;
    return { correctionUnits, snapped: correctionUnits !== null && snapped, pending: predictor.pendingCount };
  }

  /** Server time remote critters are drawn at (see InterpClock). */
  remoteRenderTime(serverNow: number): number {
    return this.interp.renderTime(serverNow);
  }

  /** Remote interpolation headroom: snapshots buffered beyond the render time and how far (ms). */
  interpLead(serverNow: number): { depth: number; leadMs: number } {
    return this.buffer.lead(this.interp.renderTime(serverNow));
  }

  /** One sim event, applied to both worlds the moment it arrives. */
  applyEvent(ev: GameEvent, tick: number): void {
    if (this.auth) applyWorldEvent(this.auth, ev, tick);
    if (this.predicted) applyWorldEvent(this.predicted, ev, tick);
    if (ev.type === 'balloon_kicked') this.predictor?.noteKick(ev.id, ev.slot);
  }

  /**
   * Should the presentation of an arrived event wait for the remote render clock (a remote
   * player's soak, see RemoteEventHold)? A held event comes back from releaseHeld once due.
   */
  holdPresentation(ev: GameEvent, tick: number, nowMs: number): boolean {
    return this.held.hold(ev, tick, this.mySlot, nowMs);
  }

  /** Held events due now (the remote render clock reached their tick), in arrival order. */
  releaseHeld(serverNow: number, nowMs: number): DueEvent[] {
    const renderTime = this.interp.renderTime(serverNow);
    const renderTick = this.ticks.at(renderTime);
    return this.held.release(renderTick, nowMs).map((h) => ({
      ...h,
      at: h.ev.type === 'player_soaked' ? this.soakAnchor(h.ev, renderTime - (renderTick - h.tick) * CONFIG.TICK_MS) : null,
    }));
  }

  /**
   * Where a remote critter is drawn at its soak (server time `soakTime`), kept inside the tile the
   * server soaked it on (the render clock may not have got there when a hold times out).
   */
  private soakAnchor(ev: Extract<GameEvent, { type: 'player_soaked' }>, soakTime: number): { x: number; y: number } {
    const s = this.predicted;
    const bracket = this.buffer.bracket(soakTime);
    const drawn = s && bracket ? interpolatePlayers(bracket, s.w, s.h).get(ev.slot) : undefined;
    const pos = drawn ?? this.lastDrawn.get(ev.slot) ?? tileCenterXY(ev.x, ev.y);
    const clamp = (v: number, t: number) => Math.min(t * CONFIG.SUB + CONFIG.SUB - 1, Math.max(t * CONFIG.SUB, v));
    return { x: clamp(pos.x, ev.x), y: clamp(pos.y, ev.y) };
  }

  /**
   * True once after a client tick whose predicted move kicked a balloon: the kick sounds now,
   * like a predicted drop, instead of a round trip later.
   */
  consumeKickSound(): boolean {
    const due = this.kickSoundDue;
    this.kickSoundDue = false;
    return due;
  }

  /** True for the server's balloon_kicked of an own kick whose sound already played (consumed). */
  isHeardKick(id: number, slot: number): boolean {
    const heard = slot === this.mySlot ? (this.kicksHeard.get(id) ?? 0) : 0;
    if (heard === 0) return false;
    if (heard === 1) this.kicksHeard.delete(id);
    else this.kicksHeard.set(id, heard - 1);
    return true;
  }

  /** round_end: result card until the next round_start (the final one names the match winner). */
  endRound(msg: RoundEndMsg, nowMs: number): void {
    const verdict = msg.matchOver ? verdictFromScores(msg.scores, this.contenderSlots()) : null;
    this.result = { roundNo: msg.roundNo, winner: msg.winner, scores: [...msg.scores], summaries: msg.summaries, matchOver: msg.matchOver, verdict, atMs: nowMs };
    this.scores = [...msg.scores];
    if (this.auth) this.auth.over = true;
    if (this.predicted) this.predicted.over = true;
  }

  /**
   * match_end: play stops (a forfeit ends the match mid-round, with no round_end) and the
   * placements settle the final card's verdict (soak tiebreak included).
   */
  endMatch(placements: readonly Pick<PlacementEntry, 'slot' | 'placement'>[]): void {
    if (this.auth) this.auth.over = true;
    if (this.predicted) this.predicted.over = true;
    if (this.result?.matchOver) this.result.verdict = verdictFromPlacements(placements);
  }

  /** player_status: a ranked forfeit leaves the round at once (and every later round). */
  setStatus(slot: number, status: SlotStatus): void {
    this.status.set(slot, status);
    if (!status.forfeited) return;
    for (const world of [this.auth, this.predicted]) {
      const p = world?.players[slot];
      if (p) leaveRound(p);
    }
  }

  private forfeitedSlots(): Set<number> {
    const out = new Set<number>();
    for (const [slot, st] of this.status) if (st.forfeited) out.add(slot);
    return out;
  }

  /**
   * Seated players still in the match: not known to have forfeited, and (when the round's world
   * is known) taking part in it. Only a forfeit takes a seated player out of a round, so this
   * also catches forfeits whose player_status came before a reload.
   */
  private contenderSlots(): number[] {
    const forfeited = this.forfeitedSlots();
    const world = this.auth;
    return (this.config?.players ?? [])
      .map((p) => p.slot)
      .filter((slot) => !forfeited.has(slot) && (!world || world.players[slot]?.present === true));
  }

  /** Showdown tempo: two critters left dry in a live round after the field narrowed (see isShowdown). */
  get showdown(): boolean {
    return !!this.predicted && !!this.round && isShowdown(this.predicted, this.round.contenders);
  }

  phase(serverNow: number): MatchPhase {
    if (!this.config) return 'waiting';
    // Before any round_start too: a reload between rounds gets match_start + the last round_end.
    if (this.result) return 'result';
    if (!this.round || !this.predicted) return 'intro';
    if (this.predicted.over) return 'round_over';
    return isRoundLive(serverNow, this.round.startTime) ? 'live' : 'countdown';
  }

  /** Estimated fractional server tick (0 before the round starts). */
  estTick(serverNow: number): number {
    return this.round ? this.ticks.now(serverNow) : 0;
  }

  /**
   * True while the local player can act: the round is live (never during the 3-2-1 intro) and
   * the player is dry or riding a revenge duck.
   */
  canAct(serverNow: number): boolean {
    const p = this.predicted?.players[this.mySlot];
    if (!p || !p.present || this.phase(serverNow) !== 'live') return false;
    return p.alive || p.duckPos >= 0;
  }

  /** Whether the local player's input clock runs this frame, and what happens to presses if not. */
  inputGate(serverNow: number): InputGate {
    if (this.canAct(serverNow)) return 'act';
    const round = this.round;
    const goWindow = !!round && this.phase(serverNow) === 'countdown' && isGoWindow(serverNow, round.startTime);
    return goWindow ? 'hold' : 'drop';
  }

  /**
   * One 30 Hz client tick: predicts the local move and returns the input message fields, or
   * null when the player may not act (the caller must then drop any latched presses).
   */
  localTick(dir: DirCode, balloon: boolean, serverNow: number): LocalInput | null {
    const predicted = this.predicted;
    const predictor = this.predictor;
    if (!predicted || !predictor || !this.canAct(serverNow)) return null;
    const { seq, kickedId } = predictor.tick(predicted, dir);
    if (kickedId >= 0) {
      this.kicksHeard.set(kickedId, (this.kicksHeard.get(kickedId) ?? 0) + 1);
      this.kickSoundDue = true;
    }
    return { seq, tick: Math.floor(this.estTick(serverNow)), dir, balloonPressed: balloon };
  }

  /**
   * Show a ghost balloon for a drop the server will most likely accept (same checks as the
   * sim: dry, under the cap, floor tile, no balloon, not flooded). Returns true if shown.
   */
  predictDrop(nowMs: number, rttMs: number): boolean {
    const s = this.predicted;
    const p = s?.players[this.mySlot];
    if (!s || !p || !p.alive) return false;
    const tx = tileOf(p.x);
    const ty = tileOf(p.y);
    const i = idx(s.w, tx, ty);
    if (activeBalloonCount(s, p.slot) + this.drops.length >= p.maxBalloons) return false;
    if (s.tiles[i] !== Tile.Floor || balloonAt(s, tx, ty) || isFlooded(s, tx, ty)) return false;
    if (this.drops.some((d) => d.tx === tx && d.ty === ty)) return false;
    this.drops.push({ tx, ty, slot: p.slot, untilMs: nowMs + Math.min(GHOST_MAX_MS, rttMs + 250) });
    return true;
  }

  /** Remove ghost drops that the server confirmed (a balloon is on the tile) or that expired. */
  pruneDrops(nowMs: number): void {
    const s = this.predicted;
    if (!s || this.drops.length === 0) return;
    this.drops = this.drops.filter((d) => nowMs < d.untilMs && !balloonAt(s, d.tx, d.ty));
  }

  /**
   * Draw positions (sub-units) of the local player's own sliding balloons: predicted along with
   * the critter and led `alpha` of a tick like it, so the kicker never walks into the balloon it
   * is following. Empty while no input is pending (the predicted world is then the snapshot, and
   * the renderer's snapshot extrapolation applies).
   */
  ownSlides(alpha: number): Map<number, LocalPosition> {
    const s = this.predicted;
    const predictor = this.predictor;
    if (!s || !predictor || predictor.pendingCount === 0) return new Map();
    return slideLead(s, predictor.ownKicks, alpha);
  }

  /** Where a slot was last drawn (sub-units), e.g. to anchor its soak animation. */
  drawnPosition(slot: number): { x: number; y: number } | null {
    return this.lastDrawn.get(slot) ?? null;
  }

  /**
   * Every present critter as it should be drawn now. Remote players are interpolated; the local
   * critter is drawn `lead.alpha` of the way toward its next tick in `lead.dir`.
   */
  actors(serverNow: number, lead: LocalLead = NO_LEAD): ActorView[] {
    const s = this.predicted;
    // A re-joined round only knows the spawn tiles until its first snapshot places everyone.
    if (!s || (this.round?.resumed && this.lastSnapshotTick < 0)) return [];
    const est = this.estTick(serverNow);
    const bracket = this.buffer.bracket(this.interp.renderTime(serverNow));
    const remote = bracket ? interpolatePlayers(bracket, s.w, s.h) : new Map<number, InterpolatedPlayer>();
    const out: ActorView[] = [];
    for (const p of s.players) {
      if (!p.present) continue;
      const local = p.slot === this.mySlot;
      const view = local ? this.localActor(s, p.slot, lead) : this.remoteActor(s, p.slot, remote.get(p.slot));
      view.duckCooldown = view.duck ? Math.max(0, p.duckCooldownUntil - est) : 0;
      if (view.alive) this.lastDrawn.set(p.slot, { x: view.x, y: view.y });
      out.push(view);
    }
    return out;
  }

  private localActor(s: RoundState, slot: number, lead: LocalLead): ActorView {
    const p = s.players[slot];
    const pos = localPosition(s, slot) ?? { x: p.x, y: p.y };
    const duck = !p.alive && p.duckPos >= 0 ? { x: pos.x + this.error.x, y: pos.y + this.error.y } : null;
    const ahead = stepLead(s, slot, lead.dir, lead.alpha);
    const x = p.alive ? p.x + ahead.dx + this.error.x : p.x;
    const y = p.alive ? p.y + ahead.dy + this.error.y : p.y;
    return { slot, local: true, x, y, facing: p.facing, moving: p.moving || ahead.moving, alive: p.alive, duck, duckCooldown: 0 };
  }

  private remoteActor(s: RoundState, slot: number, ip: InterpolatedPlayer | undefined): ActorView {
    const p = s.players[slot];
    // Revivals come from snapshots and soaks from events immediately, except that a held soak
    // (see RemoteEventHold) keeps the critter dry until the render clock reaches it. Positions
    // come from interpolation.
    const alive = p.alive || this.held.holdsSoakOf(slot);
    const duckNow = !alive && p.duckPos >= 0;
    const src = ip ?? { x: p.x, y: p.y, facing: p.facing, moving: p.moving, duck: null };
    const duck = duckNow ? src.duck ?? localPosition(s, slot) : null;
    return { slot, local: false, x: src.x, y: src.y, facing: src.facing, moving: alive && src.moving, alive, duck, duckCooldown: 0 };
  }
}

/** Tick 0 of a round as a timed snapshot: every critter taking part on its spawn at startTime. */
function spawnLayout(s: RoundState, startTime: number): TimedSnapshot {
  return { serverTime: startTime, tick: 0, players: s.players.filter((p) => p.present).map((p) => toPlayerSnap(s, p)) };
}

/** Sub-unit center of a tile (event coordinates are tiles). */
export function tileCenterXY(tx: number, ty: number): { x: number; y: number } {
  return { x: tileCenter(tx), y: tileCenter(ty) };
}
