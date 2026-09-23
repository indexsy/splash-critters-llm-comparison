// The canvas match view shared by the game and tutorial screens: owns a GameSession and the
// requestAnimationFrame loop that updates it and draws each frame into the 256x224 backbuffer.
import type { MatchEndMsg } from '@splash/shared';
import { audio, type MusicTrack } from '../audio';
import { frame } from '../frame';
import { input } from '../input';
import { net } from '../net';
import { drawWaiting } from '../render/overlays';
import { settings } from '../settings';
import { netStats } from './netStats';
import { GameSession } from './session';
import './game.css';

/** Frame deltas above this (tab switch, breakpoint) are clamped for effects and interpolation. */
const MAX_FRAME_MS = 100;

export interface GameViewOptions {
  music: MusicTrack;
  /** Called once, MATCH_END_LINGER_MS after the final round result / match_end. */
  onMatchOver: (end: MatchEndMsg) => void;
}

export class GameView {
  readonly session: GameSession;
  private raf = 0;
  private lastMs = 0;

  constructor(private readonly opts: GameViewOptions) {
    this.session = new GameSession(opts.onMatchOver);
  }

  mount(): void {
    this.session.start();
    input.setGameplayActive(true);
    audio.music(this.opts.music);
    this.lastMs = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    netStats.attach();
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.session.stop();
    input.setGameplayActive(false);
    netStats.detach();
  }

  private loop = (nowMs: number): void => {
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    try {
      this.session.update(nowMs, dt);
      const scene = this.session.scene(nowMs);
      if (scene) {
        this.session.renderer.render(frame.ctx, scene, dt, settings.get().reducedShake);
        netStats.frame(nowMs, scene.actors, this.session.state.remoteRenderTime(scene.serverNow));
      } else drawWaiting(frame.ctx, net.status === 'open' ? 'JOINING MATCH' : 'RECONNECTING', nowMs);
    } catch (err) {
      console.error('[game] frame failed', err);
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}
