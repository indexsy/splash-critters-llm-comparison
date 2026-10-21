import { CONFIG, type GameState } from '@splash-critters/shared';
import { audio } from '../audio.js';
import type { App } from '../app.js';
import type { LocalInput } from '../prediction.js';
import { PALETTE } from '../render/sprites.js';
import { drawText } from '../render/font.js';
import { button, clear, el, panel } from '../ui.js';
import { markTutorialDone } from '../state.js';

const OBJECTIVES = [
  'MOVE AROUND - WASD OR ARROW KEYS',
  'DROP A BALLOON (SPACE) THEN DODGE THE SPLASH',
  'GRAB A POWER UP - IT HIDES IN THE SANDCASTLES',
  'CHAIN TWO BALLOONS FOR A DOUBLE SPLASH',
  'SOAK THE BOT AND WIN THE ROUND',
];

/** Keeps track of the tutorial goals and paints the objective banner. */
export class TutorialDirector {
  step = 0;
  completed = false;
  private requested = false;
  private startX = 0;
  private startY = 0;
  private dropped = false;
  private dodged = false;

  get active(): boolean {
    return this.requested && !this.completed;
  }

  reset(ranked: boolean): void {
    this.step = 0;
    this.completed = false;
    this.dropped = false;
    this.dodged = false;
    void ranked;
  }

  enable(): void {
    this.requested = true;
    this.step = 0;
    this.completed = false;
  }

  onRoundStart(): void {
    this.dropped = false;
    this.dodged = false;
    this.step = 0;
  }

  onTick(state: GameState | null, input: LocalInput | null): void {
    if (!this.active || !state || this.completed) return;
    const player = state.players.find((p) => p.id === 0);
    if (!player) return;
    if (this.step === 0) {
      if (this.startX === 0 && this.startY === 0) {
        this.startX = player.x;
        this.startY = player.y;
      }
      if (Math.abs(player.x - this.startX) > 0.6 || Math.abs(player.y - this.startY) > 0.6) {
        this.advance();
      }
    }
    if (this.step === 1) {
      if (state.balloons.some((b) => b.owner === 0)) this.dropped = true;
      if (this.dropped && input && input.dir !== 0) {
        this.dodged = true;
      }
      if (this.dropped && this.dodged) this.advance();
    }
    if (this.step === 2) {
      if (
        player.balloonCount > CONFIG.BALLOON_COUNT_BASE ||
        player.splashRange > CONFIG.SPLASH_RANGE_BASE ||
        player.speed > CONFIG.SPEED_BASE
      ) {
        this.advance();
      }
    }
    if (this.step === 3) {
      if (player.biggestChain >= 2) this.advance();
    }
    if (this.step === 4) {
      if (player.roundWins > 0) {
        this.completed = true;
        audio.play('victory');
      }
    }
  }

  private advance(): void {
    if (this.step < OBJECTIVES.length - 1) {
      this.step += 1;
      audio.play('click');
    }
  }

  render(ctx: CanvasRenderingContext2D, app: App): void {
    if (!this.active && !this.completed) return;
    const text = this.completed ? 'TUTORIAL COMPLETE! +50 XP' : OBJECTIVES[this.step];
    const color = this.completed ? PALETTE.yellow : PALETTE.sky;
    ctx.fillStyle = 'rgba(9,15,30,0.8)';
    ctx.fillRect(0, 168, 256, 14);
    drawText(ctx, text, 128, 172, { align: 'center', color });
    if (this.completed) {
      drawText(ctx, 'PRESS ENTER FOR THE MENU', 128, 186, {
        align: 'center',
        color: PALETTE.white,
      });
    }
    void app;
  }
}

/** DOM screen that creates the tutorial room and drives the intro. */
export class TutorialScreen {
  private app: App | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    const root = panel(
      'How to play',
      el('p', {}, [
        'You are a critter with water balloons. Drop them, dodge the cross shaped splash and soak everybody else.',
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'hint' }, ['MOVE']),
        el('span', { class: 'kbd' }, ['W A S D']),
        el('span', { class: 'kbd' }, ['ARROWS']),
        el('span', { class: 'hint' }, ['DROP']),
        el('span', { class: 'kbd' }, ['SPACE']),
        el('span', { class: 'hint' }, ['EMOTE']),
        el('span', { class: 'kbd' }, ['1-4']),
      ]),
      el('div', { class: 'row' }, [
        button('Start tutorial', () => this.start(), 'primary'),
        button('Skip', () => {
          markTutorialDone();
          app.go('menu');
        }),
      ]),
      el('p', { class: 'hint' }, ['The tutorial is a real match against an easy bot and takes about two minutes.']),
    );
    app.overlay.appendChild(root);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* nothing to animate */
  }

  private start(): void {
    const app = this.app;
    if (!app) return;
    app.game?.tutorialDirector.enable();
    app.tutorialPending = true;
    app.send({
      t: 'create_room',
      opts: {
        name: 'Tutorial',
        maxPlayers: 2,
        isPublic: false,
        theme: 'backyard',
        roundsToWin: 3,
        botFill: false,
      },
    });
  }
}
