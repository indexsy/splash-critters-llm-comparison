import { audio } from '../audio.js';
import type { App } from '../app.js';
import { PALETTE, drawCritter, drawHat, TILE } from '../render/sprites.js';
import { drawText } from '../render/font.js';
import { bottomPanel, button, clear, el } from '../ui.js';
import { tutorialDone } from '../state.js';

/** Animated pixel title screen with a few critters milling about. */
export class TitleScreen {
  private app: App | null = null;
  private time = 0;
  private walkers = [
    { animal: 'frog' as const, x: 20, speed: 12, dir: 1 },
    { animal: 'duck' as const, x: 120, speed: -9, dir: 2 },
    { animal: 'otter' as const, x: 200, speed: 7, dir: 1 },
  ];

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    audio.playMusic('title');
    const profile = app.state.profile;
    const root = bottomPanel(
      'Splash Critters',
      el('p', {}, ['An 8-bit online water balloon battler. Last critter dry wins.']),
      el('div', { class: 'row' }, [
        el('span', {}, [
          profile ? `Signed in as ${profile.nickname}#${profile.tag}` : 'Connecting…',
        ]),
      ]),
      el('div', { class: 'row' }, [
        button('Play', () => app.go('menu'), 'primary'),
        !tutorialDone()
          ? button('Tutorial', () => app.go('tutorial'))
          : button('How to play', () => app.go('help')),
      ]),
      el('p', { class: 'hint' }, ['best with friends - 2 to 4 players']),
    );
    app.overlay.appendChild(root);
    this.focusOverlay(root);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(dt: number): void {
    this.time += dt;
    for (const walker of this.walkers) {
      walker.x += walker.speed * dt;
      if (walker.x > 240) walker.x = -20;
      if (walker.x < -20) walker.x = 250;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const app = this.app;
    if (!app) return;
    // sky
    const gradient = ctx.createLinearGradient(0, 0, 0, 224);
    gradient.addColorStop(0, '#2b4a80');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 224);

    // sun and clouds
    ctx.fillStyle = '#f7d14b';
    ctx.beginPath();
    ctx.arc(212, 34, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(253,246,227,0.18)';
    for (let i = 0; i < 4; i++) {
      const x = ((this.time * 6 + i * 70) % 300) - 30;
      ctx.fillRect(x, 24 + i * 16, 30, 6);
      ctx.fillRect(x + 8, 20 + i * 16, 16, 6);
    }

    // water
    ctx.fillStyle = '#2b6f9c';
    ctx.fillRect(0, 168, 256, 56);
    ctx.fillStyle = 'rgba(143,216,240,0.5)';
    for (let i = 0; i < 16; i++) {
      const x = (i * 17 + Math.floor(this.time * 12)) % 256;
      ctx.fillRect(x, 172 + (i % 5) * 10, 10, 2);
    }

    // logo
    drawText(ctx, 'SPLASH', 128, 70, {
      align: 'center',
      color: PALETTE.sky,
      shadow: PALETTE.ink,
      scale: 4,
    });
    drawText(ctx, 'CRITTERS', 128, 104, {
      align: 'center',
      color: PALETTE.yellow,
      shadow: PALETTE.ink,
      scale: 3,
    });
    drawText(ctx, '8-BIT WATER BALLOON BATTLER', 128, 132, {
      align: 'center',
      color: 'rgba(253,246,227,0.65)',
    });

    for (const walker of this.walkers) {
      const frame = Math.floor(this.time * 6) % 2;
      drawCritter(ctx, walker.animal, Math.round(walker.x), 140, frame, walker.dir);
    }
    void TILE;
  }

  private focusOverlay(root: HTMLElement): void {
    root.style.pointerEvents = 'auto';
  }
}
