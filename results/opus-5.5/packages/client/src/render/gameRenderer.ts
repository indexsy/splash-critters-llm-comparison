// Frame composer for the match view: waiting card, VS intro card, or arena + HUD + kill feed +
// announcer + countdown + round result card. Owns the transient visual state (fx, announcer,
// kill feed) that the event presenter feeds.
import type { RoundState, Theme } from '@splash/shared';
import { introPhase } from '../game/clock';
import type { Scene } from '../game/scene';
import { Announcer } from './announcer';
import { SCREEN_H, SCREEN_W, arenaLayout } from './camera';
import { drawIntroCard, drawResultBetweenRounds, drawRoundResult } from './cards';
import { Fx } from './fx';
import { drawHud } from './hud';
import { KillFeed } from './killfeed';
import { THEME_PALETTES, type ThemePalette } from './palette';
import { drawCountdown } from './overlays';
import { WorldRenderer } from './world';

export class GameRenderer {
  readonly fx = new Fx();
  readonly announcer = new Announcer();
  readonly killFeed = new KillFeed();
  private readonly world = new WorldRenderer();
  private theme: ThemePalette = THEME_PALETTES.backyard;
  private themeId: Theme = 'backyard';

  get currentTheme(): Theme {
    return this.themeId;
  }

  /** New round: rebuild the static arena and drop every transient effect. */
  prepareRound(s: RoundState, theme: Theme, seed: number): void {
    this.world.prepare(s, theme, seed);
    this.theme = THEME_PALETTES[theme];
    this.themeId = theme;
    this.fx.reset();
    this.announcer.clear();
  }

  /** A castle washed away: patch the cached arena layer. */
  washTile(s: RoundState, tx: number, ty: number): void {
    this.world.washTile(s, tx, ty);
  }

  /**
   * Draw one frame. During a hit-stop the previous frame stays on screen (nothing is drawn and
   * no effect advances), which freezes the moment of impact.
   */
  render(ctx: CanvasRenderingContext2D, scene: Scene, dtMs: number, reducedShake: boolean): void {
    const now = scene.nowMs;
    if (this.fx.holding(now)) return;
    this.fx.update(now, dtMs);
    if (!scene.world || !scene.round) {
      // A reload between rounds gets the last round_end before any round_start.
      if (scene.result) this.drawResultOnly(ctx, scene);
      else drawIntroCard(ctx, scene.config, now - scene.introStartMs, now, scene.colorblind);
      return;
    }
    const layout = arenaLayout(scene.world.w, scene.world.h);
    ctx.fillStyle = this.theme.backdrop;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    this.world.draw(ctx, scene, this.fx, layout, this.fx.shake.offset(now, reducedShake));
    drawHud(ctx, scene, layout);
    this.killFeed.draw(ctx, layout, scene.colorblind, now, scene.config.tutorial);
    this.announcer.draw(ctx, layout.ax + layout.aw / 2, layout.ay + layout.ah / 2 - 24, now);
    if (!scene.round.resumed) {
      const title = scene.config.tutorial ? 'GET READY' : `ROUND ${scene.round.roundNo}`;
      drawCountdown(ctx, introPhase(scene.serverNow, scene.round.startTime), title, layout);
    }
    if (scene.phase === 'result' && scene.result) drawRoundResult(ctx, scene.result, scene.config, layout, now, scene.colorblind);
    this.fx.afterFrame(now);
  }

  /** Result card and HUD with no arena behind them (no round_start received yet). */
  private drawResultOnly(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (!scene.result) return;
    const layout = arenaLayout(scene.config.w, scene.config.h);
    drawResultBetweenRounds(ctx, scene.result, scene.config, layout, scene.nowMs, scene.colorblind);
    drawHud(ctx, scene, layout);
  }
}
