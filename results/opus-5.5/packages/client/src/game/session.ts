// Live match session: routes server messages into MatchState (netcode) and EventPresenter
// (juice), runs the 30 Hz input clock off requestAnimationFrame deltas, keeps the music in step
// (countdown beeps, showdown tempo) and produces the Scene the renderer draws every frame.
import {
  CONFIG,
  Dir,
  tileOf,
  type EmoteId,
  type MatchConfig,
  type MatchEndMsg,
  type MsgOf,
  type RoundEndMsg,
  type RoundStartMsg,
  type S2C,
} from '@splash/shared';
import { audio } from '../audio';
import { input } from '../input';
import { net } from '../net';
import { createSeqCounter } from '../prediction';
import { panForTile } from '../render/camera';
import { GameRenderer } from '../render/gameRenderer';
import { settings } from '../settings';
import { store } from '../store';
import { introPhase } from './clock';
import { InputPacer } from './inputPacer';
import { matchLiveness } from './liveness';
import { MatchState } from './matchState';
import { netStats } from './netStats';
import { EventPresenter } from './presenter';
import type { Scene } from './scene';

/** One sequence counter for the page's lifetime: seq keeps increasing across rounds and matches. */
const nextSeq = createSeqCounter();
/** The results screen opens this long after the final round result (or match_end). */
const MATCH_END_LINGER_MS = 2500;
/** A soak animation older than this is dropped once its critter is dry again (tutorial revives). */
const REVIVE_CLEAR_MS = 400;
/** Our own emote comes back from the server; it was already shown when sent. */
const EMOTE_ECHO_MS = 1500;

export class GameSession {
  readonly state = new MatchState(nextSeq);
  readonly renderer = new GameRenderer();
  private readonly presenter: EventPresenter;
  private readonly pacer = new InputPacer(input);
  private unsubs: (() => void)[] = [];
  private lastCountdown = 0;
  private goPlayedRound = -1;
  private showdown = false;
  private lastEmoteMs = -Infinity;
  private emoteEcho: { id: EmoteId; atMs: number } | null = null;
  private matchEnd: MatchEndMsg | null = null;
  private matchEndAtMs = 0;
  private finalResultAtMs = 0;
  private matchOverFired = false;
  /** While a menu is open over the match the critter stands still (Dir.None is still sent). */
  inputBlocked = false;

  constructor(private readonly onMatchOver: (end: MatchEndMsg) => void) {
    this.presenter = new EventPresenter(this.state, this.renderer, () => settings.get().colorblind);
  }

  start(): void {
    const { match, matchEnd } = store.get();
    // A match that already ended (e.g. the last one, kept for the results screen) is not live.
    if (match && matchLiveness(match, matchEnd) === 'live') this.startMatch(match);
    this.unsubs = [
      store.subscribe((next, prev) => {
        if (next.match && next.match !== prev.match) this.startMatch(next.match);
      }),
      net.on('round_start', (m) => this.onRoundStart(m)),
      net.on('snapshot', (m) => this.onSnapshot(m)),
      net.on('event', (m) => this.onEvents(m)),
      net.on('round_end', (m) => this.onRoundEnd(m)),
      net.on('match_end', (m) => this.onMatchEnd(m)),
      net.on('emote', (m) => this.onEmote(m)),
      net.on('player_status', (m) => this.state.setStatus(m.slot, { connected: m.connected, replacedByBot: m.replacedByBot, forfeited: m.forfeited })),
    ];
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.showdown) audio.setShowdown(false);
    this.showdown = false;
  }

  private startMatch(config: MatchConfig): void {
    if (this.state.config?.matchId !== config.matchId) {
      this.matchEnd = null;
      this.matchOverFired = false;
      this.finalResultAtMs = 0;
      this.renderer.killFeed.clear();
    }
    this.state.startMatch(config, performance.now());
  }

  private onRoundStart(msg: RoundStartMsg): void {
    const pending = store.get().match;
    if (!this.state.config && pending) this.startMatch(pending);
    this.state.startRound(msg, net.serverNow());
    const world = this.state.predicted;
    if (!world) return;
    this.renderer.prepareRound(world, msg.theme, msg.mapSeed);
    this.renderer.killFeed.clear();
    this.pacer.reset();
    input.clearLatches();
    this.lastCountdown = 0;
    netStats.roundStarted();
    if (this.showdown) audio.setShowdown(false);
    this.showdown = false;
  }

  private onSnapshot(msg: MsgOf<S2C, 'snapshot'>): void {
    const serverNow = net.serverNow();
    const rec = this.state.applySnapshot(msg, serverNow);
    if (rec) netStats.snapshot(msg.ack, performance.now(), rec.correctionUnits, rec.snapped, rec.pending, this.state.interpLead(serverNow));
  }

  private onEvents(msg: MsgOf<S2C, 'event'>): void {
    const now = performance.now();
    for (const ev of msg.events) {
      this.state.applyEvent(ev, msg.tick);
      // A remote soak is shown when its critter, drawn in the past, reaches it (see update).
      if (!this.state.holdPresentation(ev, msg.tick, now)) this.presenter.present(ev, now);
    }
  }

  /**
   * round_end: the result card. The round's own sting already played on round_over; the match
   * fanfare (from the final placements) belongs to the results screen, so none is played here.
   */
  private onRoundEnd(msg: RoundEndMsg): void {
    const now = performance.now();
    this.state.endRound(msg, now);
    if (msg.matchOver) this.finalResultAtMs = now;
  }

  private onMatchEnd(msg: MatchEndMsg): void {
    this.matchEnd = msg;
    this.matchEndAtMs = performance.now();
    this.state.endMatch(msg.placements);
    if (!this.finalResultAtMs && !msg.tutorial) this.presenter.matchEnded(this.matchEndAtMs);
  }

  private onEmote(msg: MsgOf<S2C, 'emote'>): void {
    const now = performance.now();
    const echo = this.emoteEcho;
    if (msg.slot === this.state.mySlot && echo && echo.id === msg.id && now - echo.atMs < EMOTE_ECHO_MS) {
      this.emoteEcho = null;
      return;
    }
    this.presenter.emote(msg.slot, msg.id, now);
  }

  /** Keys 1-4: send an emote (client-side cooldown mirrors the server's rate limit). */
  private sendEmote(id: EmoteId, nowMs: number): void {
    if (!this.state.config || nowMs - this.lastEmoteMs < CONFIG.EMOTE_COOLDOWN_MS) return;
    if (!net.send({ type: 'emote', id })) return;
    this.lastEmoteMs = nowMs;
    this.emoteEcho = { id, atMs: nowMs };
    this.presenter.emote(this.state.mySlot, id, nowMs);
  }

  /** A hidden tab stops ticking: tell the server to stop walking instead of repeating the last direction. */
  private onVisibility = (): void => {
    if (!document.hidden) return;
    const serverNow = net.serverNow();
    const msg = net.status === 'open' ? this.state.localTick(Dir.None, false, serverNow) : null;
    if (msg) net.send({ type: 'input', ...msg });
  };

  /** 30 Hz client ticks: predict, send, and show a ghost balloon for accepted-looking drops. */
  private runInput(nowMs: number, dtMs: number, serverNow: number): void {
    const emote = input.consumeEmote();
    if (emote !== null && !this.inputBlocked) this.sendEmote(emote, nowMs);
    // No inputs before the round's first tick, while soaked without a duck or offline. A press
    // during the 3-2-1 is dropped, one at "SPLASH!" is kept for the first tick (see InputGate).
    const steps = this.pacer.ticksDue(net.status === 'open' ? this.state.inputGate(serverNow) : 'drop', dtMs);
    for (let i = 0; i < steps; i++) {
      const blocked = this.inputBlocked;
      if (blocked) input.clearLatches();
      const balloon = !blocked && input.consumeBalloon();
      const msg = this.state.localTick(blocked ? Dir.None : input.currentDir(), balloon, serverNow);
      if (!msg) return;
      net.send({ type: 'input', ...msg });
      netStats.inputSent(msg.seq, nowMs);
      if (this.state.consumeKickSound()) audio.sfx('kick');
      if (balloon && this.state.predictDrop(nowMs, net.rtt)) {
        const p = this.state.predicted?.players[this.state.mySlot];
        audio.sfx('drop', { pan: p ? panForTile(tileOf(p.x), this.state.predicted?.w ?? 1) : 0 });
      }
    }
  }

  /** 3-2-1 beeps and the "go" sting, synced to round_start.startTime. */
  private runCountdownAudio(serverNow: number): void {
    const round = this.state.round;
    if (!round || round.resumed) return;
    const phase = introPhase(serverNow, round.startTime);
    if (phase.kind === 'count' && phase.n !== this.lastCountdown) {
      this.lastCountdown = phase.n;
      audio.sfx('countdown');
    } else if (phase.kind === 'go' && this.goPlayedRound !== round.roundNo) {
      this.goPlayedRound = round.roundNo;
      audio.sfx('go');
    }
  }

  /** Showdown tempo while two critters are left dry in a live round (see MatchState.showdown). */
  private runShowdown(serverNow: number): void {
    const on = this.state.phase(serverNow) === 'live' && this.state.showdown;
    if (on !== this.showdown) {
      this.showdown = on;
      audio.setShowdown(on);
    }
  }

  private checkMatchOver(nowMs: number): void {
    if (!this.matchEnd || this.matchOverFired) return;
    const since = Math.max(this.matchEndAtMs, this.finalResultAtMs);
    if (nowMs - since < MATCH_END_LINGER_MS) return;
    this.matchOverFired = true;
    this.onMatchOver(this.matchEnd);
  }

  /** Clear soak puddles of critters the server revived (tutorial sandbox). */
  private syncRevives(nowMs: number): void {
    const s = this.state.predicted;
    if (!s) return;
    for (const [slot, soak] of this.renderer.fx.soaks) {
      if (s.players[slot]?.alive && nowMs - soak.startMs > REVIVE_CLEAR_MS) this.renderer.fx.soaks.delete(slot);
    }
  }

  /** Per-frame update (before rendering). */
  update(nowMs: number, dtMs: number): void {
    const serverNow = net.serverNow();
    this.runInput(nowMs, dtMs, serverNow);
    for (const due of this.state.releaseHeld(serverNow, nowMs)) this.presenter.present(due.ev, nowMs, due.at);
    this.runCountdownAudio(serverNow);
    this.runShowdown(serverNow);
    this.state.error.decay(dtMs);
    this.state.pruneDrops(nowMs);
    this.syncRevives(nowMs);
    this.checkMatchOver(nowMs);
  }

  /** What to draw this frame, or null while no match config is known yet. */
  scene(nowMs: number): Scene | null {
    const config = this.state.config;
    if (!config) return null;
    const serverNow = net.serverNow();
    const s = settings.get();
    const lead = { dir: this.inputBlocked ? Dir.None : input.peekDir(), alpha: this.pacer.phase() };
    return {
      nowMs,
      serverNow,
      estTick: this.state.estTick(serverNow),
      colorblind: s.colorblind,
      showPing: s.showPing,
      config,
      mySlot: this.state.mySlot,
      phase: this.state.phase(serverNow),
      introStartMs: this.state.introStartMs,
      round: this.state.round,
      world: this.state.predicted,
      actors: this.state.actors(serverNow, lead),
      ownSlides: this.state.ownSlides(lead.alpha),
      drops: this.state.ghostDrops,
      scores: this.state.scores,
      pings: this.state.pings,
      status: this.state.status,
      result: this.state.result,
    };
  }
}
