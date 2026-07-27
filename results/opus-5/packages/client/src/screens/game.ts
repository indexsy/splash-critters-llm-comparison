/**
 * The in-match screen: the one place where the predicted world, the renderer,
 * the HUD and the audio layer all meet.
 *
 * `createGameView` is the whole experience and takes hooks, so the tutorial can
 * wrap it and paint its objectives on top instead of reimplementing a match.
 * `createGameScreen` is the plain version the router mounts at '/game'.
 *
 * The frame reads like the frame it draws: sample input, advance the overlays,
 * take a view of the world at the interpolated render tick, then paint arena,
 * particles, HUD, feed, announcer and finally whatever the caller wants on top.
 */

import { CONFIG, type MatchConfig, type SimEvent } from '@splash/shared';
import { initAudio, playSfx, setMusicSpeed, startMusic, toggleMute } from '../audio';
import { on, renderTick, seedServerTick, send } from '../net';
import { PredictedWorld } from '../prediction';
import { Announcer, KillFeed, Shaker, drawHud, type HudState } from '../render/hud';
import { ParticleField } from '../render/particles';
import { UI, arenaLayout, type ArenaLayout } from '../render/palette';
import { drawArena, type RenderPlayer, type RenderState } from '../render/world';
import { navigate, type Screen } from '../router';
import { getSettings } from '../settings';
import { STAGE_HEIGHT, STAGE_WIDTH, getContext, showStage } from '../stage';
import { getState, pushToast, setState } from '../store';
import { button, el, panel } from '../ui/dom';
import { createMatchFeedback, feedName } from './gameEvents';
import { createGameInput } from './gameInput';
import {
  drawDuckHint,
  drawRoundBoard,
  drawSpectatorBadge,
  drawVsCard,
  drawWaiting,
  shortKeyLabel,
} from './gameOverlay';

/** Minimum time the VS card holds, even if round_start beats it there. */
const INTRO_MS = 2500;
/** Two ticks of freeze on a soak, which is what sells the hit. */
const HIT_STOP_MS = 66;
/** How long "ROUND n" owns the announcer before the countdown takes over. */
const ROUND_BANNER_MS = 900;

export interface GameOverlayInfo {
  ctx: CanvasRenderingContext2D;
  layout: ArenaLayout;
  players: RenderPlayer[];
  mySlot: number;
  tick: number;
}

export interface GameViewOptions {
  /** Drawn every frame, after the HUD and the announcer. */
  overlay?(info: GameOverlayInfo): void;
  onEvent?(ev: SimEvent): void;
  onRoundStart?(roundNo: number): void;
  /** Suppresses the leave-match confirm and every navigation of our own. */
  standalone?: boolean;
}

export function createGameView(opts: GameViewOptions = {}): Screen {
  const particles = new ParticleField();
  const feed = new KillFeed();
  const announcer = new Announcer();
  const shaker = new Shaker();

  let config: MatchConfig | null = null;
  let world: PredictedWorld | null = null;
  let layout = arenaLayout(CONFIG.FFA_WIDTH, CONFIG.FFA_HEIGHT);
  let lastState: RenderState | null = null;

  let scores: number[] = [];
  let pings: number[] = [];
  let roundNo = 0;
  let roundWinners: number[] = [];
  let roundStarted = false;

  let elapsedMs = 0;
  let introStartedAt = 0;
  let introEndsAt = 0;
  let roundBannerUntil = 0;
  let boardUntil = 0;
  let hitStopMs = 0;
  let frozenTick = 0;
  let lastCountdown = -1;
  let lastPhase: HudState['phase'] = 'countdown';
  let showdown = false;
  let confirming = false;

  const unsubscribe: Array<() => void> = [];

  // ------------------------------------------------------------------- helpers

  function dropKeyLabel(): string {
    const codes = getSettings().keybinds.drop;
    return codes.length > 0 ? shortKeyLabel(codes[0]) : 'the drop key';
  }

  function introActive(): boolean {
    return !roundStarted || performance.now() < introEndsAt;
  }

  const feedback = createMatchFeedback({
    particles,
    feed,
    announcer,
    shaker,
    roster: () => config?.players ?? [],
    scene: () => lastState,
    onHitStop: () => {
      frozenTick = renderTick();
      hitStopMs = HIT_STOP_MS;
    },
  });

  // ----------------------------------------------------------------- lifecycle

  function begin(next: MatchConfig): void {
    config = next;
    world = new PredictedWorld(next);
    layout = arenaLayout(next.width, next.height);
    scores = next.players.map(() => 0);
    pings = [];
    roundNo = 0;
    roundStarted = false;
    showdown = false;
    lastCountdown = -1;
    lastPhase = 'countdown';
    lastState = null;
    introStartedAt = performance.now();
    introEndsAt = introStartedAt + INTRO_MS;
    boardUntil = 0;
    particles.clear();
    feed.clear();
    announcer.clear();
  }

  function leaveMatch(): void {
    send({ t: 'leave_room' });
    navigate('/menu');
    // Walking out ends this match for us, so it stops being the current one.
    setState({ match: null });
  }

  function setConfirm(next: boolean): void {
    if (opts.standalone) return;
    confirming = next;
    confirmHost.hidden = !next;
    playSfx(next ? 'ui' : 'ui_back');
    // Focus lands on the safe choice, so a stray Space or Enter keeps you in.
    if (next) stayButton.focus();
  }

  const stayButton = button('Keep playing', () => setConfirm(false), { variant: 'primary' });
  const confirmHost = el(
    'div',
    {
      class: 'screen-shell',
      hidden: true,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Leave the match?' },
    },
    panel(
      'Leave the match?',
      el('p', {
        class: 'muted',
        text: 'Your critter drops out and the rest of the match plays on without you.',
      }),
      el('div', { class: 'row' }, stayButton, button('Leave match', leaveMatch, { variant: 'danger' })),
    ),
  );

  // --------------------------------------------------------------------- input

  const input = createGameInput({
    enabled: () => world !== null && !confirming,
    onEscape: () => {
      if (opts.standalone || world === null) return;
      setConfirm(!confirming);
    },
    onMute: () => {
      const muted = toggleMute();
      pushToast('info', muted ? 'Sound off' : 'Sound on');
    },
    onEmote: (id) => {
      if (world === null) return;
      send({ t: 'emote', id });
    },
    onInput: (sampled) => {
      if (world === null || config === null || config.yourSlot < 0) return;
      world.pushInput(sampled);
      send({
        t: 'input',
        seq: sampled.seq,
        tick: sampled.tick,
        dir: sampled.dir,
        balloonPressed: sampled.balloonPressed,
      });
    },
  });

  /** Browsers refuse to start an AudioContext outside a gesture. */
  function unlockAudio(): void {
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    initAudio();
  }

  // -------------------------------------------------------------------- events

  function wireNet(): void {
    unsubscribe.push(
      on('match_start', (msg) => begin(msg.config)),

      on('round_start', (msg) => {
        if (world === null) return;
        // The tick counter restarts every round, so the estimator has to be told.
        seedServerTick(msg.startTick);
        world.beginRound(msg);
        roundNo = msg.roundNo;
        scores = [...msg.scores];
        roundStarted = true;
        showdown = false;
        lastCountdown = -1;
        lastPhase = 'countdown';
        boardUntil = 0;
        particles.clear();
        feed.clear();
        announcer.show(`Round ${msg.roundNo}`, UI.gold, ROUND_BANNER_MS, 2);
        roundBannerUntil = performance.now() + ROUND_BANNER_MS;
        startMusic('battle');
        setMusicSpeed(1);
        opts.onRoundStart?.(msg.roundNo);
      }),

      on('snapshot', (msg) => {
        if (world === null) return;
        world.applySnapshot(msg);
        scores = msg.scores;
        if (msg.pings) pings = msg.pings;
        checkShowdown();
      }),

      on('event', (msg) => {
        if (world === null) return;
        world.applyEvent(msg.tick, msg.event);
        feedback.handle(msg.event);
        opts.onEvent?.(msg.event);
      }),

      on('round_end', (msg) => {
        scores = [...msg.scores];
        roundWinners = [...msg.winners];
        boardUntil = performance.now() + (CONFIG.ROUND_END_TICKS / CONFIG.TICK_RATE) * 1000;
        const roster = config?.players ?? [];
        const winner =
          msg.winners.length > 0 ? `${feedName(roster, msg.winners[0])} wins!` : 'Drawn round';
        announcer.show(winner, UI.gold, 1800, 2);
        setMusicSpeed(1);
      }),
    );
  }

  /**
   * Only a field that has thinned out has a showdown: a duel starts with two
   * critters, so treating that as sudden death would run the fast music all game.
   */
  function checkShowdown(): void {
    if (showdown || world === null || config === null) return;
    if (config.players.length <= 2) return;
    if (world.phase !== 'playing' || world.aliveCount !== 2) return;
    showdown = true;
    startMusic('showdown');
    setMusicSpeed(1.25);
  }

  // ------------------------------------------------------------------ painting

  function announceCountdown(tick: number): void {
    if (world === null) return;
    if (world.phase === 'countdown') {
      const remaining = Math.max(0, world.phaseEndTick - tick);
      const number = Math.ceil(remaining / CONFIG.TICK_RATE);
      if (number > 0 && number !== lastCountdown) {
        lastCountdown = number;
        playSfx('countdown');
        // The round banner gets its moment first; the beeps still keep time.
        if (performance.now() >= roundBannerUntil) {
          announcer.show(String(number), UI.gold, 900, 3);
        }
      }
    }
    if (world.phase === 'playing' && lastPhase === 'countdown') {
      announcer.show('Splash!', UI.water, 900, 2);
      playSfx('go');
    }
    lastPhase = world.phase;
  }

  function hudState(live: PredictedWorld, match: MatchConfig, tick: number): HudState {
    return {
      players: live.hudPlayers(scores, pings),
      roundNo: Math.max(1, roundNo),
      roundsToWin: match.roundsToWin,
      phase: live.phase,
      countdownTicks: Math.max(0, live.phaseEndTick - tick),
      ticksUntilTide: CONFIG.TIDE_START_TICKS - tick,
      tideActive: live.tideStarted,
      showPing: getSettings().showPing,
    };
  }

  function paint(ctx: CanvasRenderingContext2D): void {
    if (world === null || config === null) {
      drawWaiting(ctx, 'Loading match', elapsedMs / 1000);
      return;
    }
    if (introActive()) {
      drawVsCard(ctx, config, (performance.now() - introStartedAt) / 1000);
      return;
    }

    const tick = hitStopMs > 0 ? frozenTick : renderTick();
    const state = world.view(tick);
    lastState = state;
    layout = arenaLayout(state.width, state.height);

    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    // The arena shakes, the HUD does not: a strip anchored to the top edge that
    // slides would just expose the background behind it.
    ctx.save();
    ctx.translate(shaker.offsetX, shaker.offsetY);
    drawArena(ctx, state, layout);
    particles.draw(ctx, layout);
    ctx.restore();

    drawHud(ctx, hudState(world, config, tick));
    feed.draw(ctx);
    announceCountdown(tick);
    announcer.draw(ctx);

    if (performance.now() < boardUntil) {
      drawRoundBoard(ctx, {
        roundNo,
        players: config.players,
        scores,
        winners: roundWinners,
        roundsToWin: config.roundsToWin,
      });
    }

    if (config.yourSlot < 0) drawSpectatorBadge(ctx);
    else if (world.localGhost) drawDuckHint(ctx, dropKeyLabel());

    opts.overlay?.({ ctx, layout, players: state.players, mySlot: config.yourSlot, tick });
  }

  // --------------------------------------------------------------------- screen

  return {
    mount(host: HTMLElement): void {
      // A match that has already ended is a memory, not something to draw: its
      // VS card would sit there for a match nobody is playing.
      const state = getState();
      const existing = state.matchEnd === null ? state.match : null;
      if (existing) begin(existing);
      else if (!opts.standalone) {
        navigate('/menu', true);
        return;
      }

      showStage(true);
      host.appendChild(confirmHost);
      window.addEventListener('pointerdown', unlockAudio);
      window.addEventListener('keydown', unlockAudio);
      wireNet();
      input.start();
    },

    unmount(): void {
      input.stop();
      for (const off of unsubscribe) off();
      unsubscribe.length = 0;
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      confirming = false;
      confirmHost.hidden = true;
      world = null;
      lastState = null;
      particles.clear();
      feed.clear();
      announcer.clear();
      showStage(false);
    },

    frame(dtMs: number): void {
      elapsedMs += dtMs;
      input.update(dtMs);
      particles.update(dtMs);
      feed.update(dtMs);
      announcer.update(dtMs);
      shaker.update(dtMs);
      if (hitStopMs > 0) hitStopMs -= dtMs;
      paint(getContext());
    },
  };
}

export function createGameScreen(): Screen {
  return createGameView();
}
