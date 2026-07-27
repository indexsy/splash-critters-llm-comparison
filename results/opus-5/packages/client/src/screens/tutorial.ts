/**
 * The guided first run.
 *
 * This is not a scripted mock-up: it opens a real private room against a real
 * bot and wraps the real match screen, then paints a strip of objectives along
 * the bottom of the stage. Every step is completed by the same sim events the
 * rest of the game listens to, so anything the player learns here is exactly
 * what happens in a live match.
 *
 * It can never strand anybody. Skip is always one click away, and if the round
 * ends first - soaked, timed out, or the bot won - the tutorial finishes down
 * the same path it would have taken on success.
 */

import { CONFIG, type SimEvent } from '@splash/shared';
import { playSfx } from '../audio';
import { on, send } from '../net';
import { UI } from '../render/palette';
import { drawText } from '../render/text';
import { currentPath, navigate, type RouteParams, type Screen } from '../router';
import { getSettings, type ActionId } from '../settings';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage';
import { mySlot, setState } from '../store';
import { button, el, panel } from '../ui/dom';
import { createGameView, type GameOverlayInfo } from './game';
import { shortKeyLabel } from './gameOverlay';

/** Tiles the player has to cover before step one counts as learned. */
const MOVE_TILES = 2;
/**
 * Exactly the band left under a duel arena (13x11 tiles centred below the HUD),
 * so the objectives never cover a tile anybody is standing on.
 */
const STRIP_HEIGHT = 16;
const STRIP_Y = STAGE_HEIGHT - STRIP_HEIGHT;
const PIP_SIZE = 4;
const PIP_STEP = 5;

interface TutorialStep {
  /** Rebuilt each frame so a mid-tutorial keybind change is honoured. */
  line(): string;
  hint: string;
}

function bindLabel(action: ActionId): string {
  const codes = getSettings().keybinds[action];
  if (codes.length === 0) return '?';
  // Shortest of the bound keys, so the strip stays on one line whatever the
  // player has remapped things to.
  return codes.map(shortKeyLabel).reduce((best, next) => (next.length < best.length ? next : best));
}

function moveKeysLabel(): string {
  return [bindLabel('up'), bindLabel('left'), bindLabel('down'), bindLabel('right')].join(' ');
}

const STEPS: TutorialStep[] = [
  { line: () => `Move with ${moveKeysLabel()}`, hint: 'Walk a couple of tiles' },
  { line: () => `Press ${bindLabel('drop')} to drop a balloon`, hint: 'Then get behind a wall' },
  { line: () => 'Wash away a sandcastle', hint: 'Then grab what was inside' },
  { line: () => 'Chain two balloons', hint: 'Drop one beside one about to burst' },
  { line: () => 'Now soak the bot!', hint: 'Corner it, then drop a balloon' },
];

/** The objective strip along the bottom edge, under the arena. */
function drawStrip(ctx: CanvasRenderingContext2D, index: number): void {
  const step = STEPS[index];
  if (step === undefined) return;

  ctx.fillStyle = UI.shadow;
  ctx.fillRect(0, STRIP_Y, STAGE_WIDTH, STRIP_HEIGHT);
  ctx.fillStyle = UI.panelEdge;
  ctx.fillRect(0, STRIP_Y, STAGE_WIDTH, 1);

  drawText(ctx, step.line(), 6, STRIP_Y + 1, UI.gold);
  drawText(ctx, step.hint, 6, STRIP_Y + 9, UI.inkDim);

  // Solid pip for done, hollow for still to come: the shape carries the state,
  // not just the colour.
  const originX = STAGE_WIDTH - 4 - (STEPS.length * PIP_STEP - 1);
  for (let i = 0; i < STEPS.length; i++) {
    const x = originX + i * PIP_STEP;
    const y = STRIP_Y + 4;
    if (i < index) {
      ctx.fillStyle = UI.good;
      ctx.fillRect(x, y, PIP_SIZE, PIP_SIZE);
      continue;
    }
    ctx.fillStyle = UI.panelEdge;
    ctx.fillRect(x, y, PIP_SIZE, 1);
    ctx.fillRect(x, y + PIP_SIZE - 1, PIP_SIZE, 1);
    ctx.fillRect(x, y, 1, PIP_SIZE);
    ctx.fillRect(x + PIP_SIZE - 1, y, 1, PIP_SIZE);
  }
}

export function createTutorialScreen(): Screen {
  let index = 0;
  let finished = false;
  let innerLive = false;
  /** Tiles walked so far, for step one. */
  let walked = 0;
  let lastX = 0;
  let lastY = 0;
  let tracking = false;
  /** Balloon the player dropped for step two, while its fuse runs. */
  let watchedBalloon = -1;
  /** Set on the frame after that balloon bursts, once soaks have been dealt. */
  let resolveSurvival = false;
  let soakedThisRound = false;

  const status = el('p', {
    class: 'field-hint',
    attrs: { 'aria-live': 'polite', role: 'status' },
    text: STEPS[0].line(),
  });
  const body = el('div', { class: 'stack' });
  const shell = el('div', { class: 'screen-shell' }, body);
  const unsubscribe: Array<() => void> = [];

  function syncStatus(): void {
    const step = STEPS[index];
    if (finished || step === undefined) {
      status.textContent = `Tutorial over. ${index} of ${STEPS.length} steps done.`;
      return;
    }
    status.textContent = `Step ${index + 1} of ${STEPS.length}. ${step.line()}. ${step.hint}.`;
  }

  function advance(): void {
    if (finished || index >= STEPS.length) return;
    index++;
    playSfx('pickup');
    if (index >= STEPS.length) {
      finish(true);
      return;
    }
    syncStatus();
  }

  /**
   * main.ts treats '/tutorial' as self-driven and suppresses its server-follow
   * navigation, so this only has to catch a stray hash left by a link or the
   * back button before the completion panel is shown.
   */
  function keepRoute(): void {
    if (currentPath() !== '/tutorial') navigate('/tutorial', true);
  }

  function showCompletion(complete: boolean): void {
    const continueButton = button('Back to the menu', () => navigate('/menu'), {
      variant: 'primary',
      wide: true,
    });
    body.replaceChildren(
      panel(
        complete ? 'Tutorial complete' : 'Tutorial ended',
        el('p', {
          text: complete
            ? 'That is the whole game: drop, hide, chain, soak.'
            : 'That is enough to get going. Replay it any time from the title screen.',
        }),
        // The server grants this once per account, however the tutorial ended.
        el('p', { class: 'muted', text: `You earned ${CONFIG.XP_TUTORIAL} XP.` }),
        el('p', {
          class: 'field-hint',
          text: 'Practice against bots any time from the menu, or jump straight into ranked.',
        }),
        continueButton,
        status,
      ),
    );
    continueButton.focus();
  }

  /** The one exit. Skip, the last step, and the match ending all come here. */
  function finish(complete: boolean): void {
    if (finished) return;
    finished = true;
    send({ t: 'set_tutorial_done' });
    send({ t: 'leave_room' });
    // Nothing from this room should push the player at the results screen, and
    // nothing later should rebuild the lesson's match from a stale config.
    setState({ matchEnd: null, rematch: null, match: null });
    keepRoute();
    playSfx(complete ? 'victory' : 'ui_back');

    if (innerLive) {
      innerLive = false;
      inner.unmount();
    }
    syncStatus();
    showCompletion(complete);
  }

  // --------------------------------------------------------------- step checks

  function trackMovement(info: GameOverlayInfo): void {
    const me = info.players.find((p) => p.slot === info.mySlot);
    if (!me || !me.alive) {
      tracking = false;
      return;
    }
    if (tracking) walked += Math.abs(me.x - lastX) + Math.abs(me.y - lastY);
    lastX = me.x;
    lastY = me.y;
    tracking = true;
    if (index === 0 && walked >= MOVE_TILES) advance();
  }

  /**
   * balloon_burst is broadcast before the soaks it caused, so surviving your own
   * balloon can only be judged a frame later, once the whole tick has landed.
   */
  function resolvePendingSurvival(): void {
    if (!resolveSurvival) return;
    resolveSurvival = false;
    if (index !== 1) return;
    if (soakedThisRound) {
      // Caught in their own splash: leave the step up and let them try again.
      watchedBalloon = -1;
      return;
    }
    advance();
  }

  function handleEvent(ev: SimEvent, mySlot: number): void {
    if (finished) return;
    switch (ev.kind) {
      case 'balloon_placed':
        if (index === 1 && ev.playerId === mySlot && watchedBalloon < 0) watchedBalloon = ev.id;
        break;
      case 'balloon_burst':
        if (index === 1 && ev.id === watchedBalloon) {
          watchedBalloon = -1;
          resolveSurvival = true;
        }
        break;
      case 'powerup_collected':
        if (index === 2 && ev.playerId === mySlot) advance();
        break;
      case 'chain_burst':
        if (index === 3 && ev.playerId === mySlot) advance();
        break;
      case 'player_soaked':
        if (ev.playerId === mySlot) soakedThisRound = true;
        else if (index === 4 && !ev.byTide && ev.byPlayerId === mySlot) advance();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- the match

  const inner = createGameView({
    standalone: true,
    onRoundStart: () => {
      walked = 0;
      tracking = false;
      watchedBalloon = -1;
      resolveSurvival = false;
      soakedThisRound = false;
    },
    onEvent: (ev) => handleEvent(ev, mySlot()),
    overlay: (info) => {
      trackMovement(info);
      resolvePendingSurvival();
      drawStrip(info.ctx, index);
    },
  });

  return {
    mount(host: HTMLElement, params: RouteParams): void {
      body.replaceChildren(
        panel(
          'Tutorial',
          status,
          el('div', { class: 'row' }, button('Skip tutorial', () => finish(false), { variant: 'ghost' })),
        ),
      );
      host.appendChild(shell);
      syncStatus();

      inner.mount(host, params);
      innerLive = true;

      unsubscribe.push(
        // The bot winning, the tide, or being soaked all land here. Finishing is
        // the only sane answer: the room is over either way.
        on('match_end', () => finish(index >= STEPS.length)),
      );

      send({
        t: 'create_room',
        opts: {
          name: 'Tutorial',
          size: 2,
          isPublic: false,
          theme: 'backyard',
          roundsToWin: 1,
          botFill: true,
          autoStart: true,
          tutorial: true,
        },
      });
    },

    unmount(): void {
      for (const off of unsubscribe) off();
      unsubscribe.length = 0;
      if (innerLive) {
        innerLive = false;
        inner.unmount();
      }
    },

    frame(dtMs: number): void {
      if (innerLive) inner.frame?.(dtMs);
    },
  };
}
