import { PALETTE } from './sprites.js';
import type { RoundState } from '@shared/sim.js';
import type { PlayerState } from '@shared/types.js';
import { CONFIG } from '@shared/config.js';
import type { ParticleSystem } from './particles.js';

interface KillFeedEntry {
  text: string;
  timer: number;
  maxTimer: number;
}

interface Announcement {
  text: string;
  timer: number;
  maxTimer: number;
  scale: number;
}

interface EmoteBubble {
  playerId: string;
  text: string;
  timer: number;
}

export class HUD {
  private killFeed: KillFeedEntry[] = [];
  private announcements: Announcement[] = [];
  private emotes: EmoteBubble[] = [];
  private ping = 0;
  private roundTimer = 0;
  private roundNo = 1;
  private roundsToWin = 3;

  setPing(p: number): void {
    this.ping = p;
  }

  setRoundTimer(t: number): void {
    this.roundTimer = t;
  }

  setRoundInfo(roundNo: number, roundsToWin: number): void {
    this.roundNo = roundNo;
    this.roundsToWin = roundsToWin;
  }

  addKillFeed(killer: string, victim: string): void {
    this.killFeed.push({
      text: `${killer} soaked ${victim}!`,
      timer: 3,
      maxTimer: 3,
    });
    if (this.killFeed.length > 5) this.killFeed.shift();
  }

  addAnnouncement(text: string): void {
    this.announcements.push({
      text,
      timer: 2,
      maxTimer: 2,
      scale: 1.5,
    });
  }

  addEmote(playerId: string, sound: string): void {
    this.emotes.push({
      playerId,
      text: sound,
      timer: 2,
    });
  }

  update(dt: number): void {
    for (const entry of this.killFeed) {
      entry.timer -= dt;
    }
    this.killFeed = this.killFeed.filter((e) => e.timer > 0);

    for (const a of this.announcements) {
      a.timer -= dt;
      a.scale = 1 + (a.timer / a.maxTimer) * 0.5;
    }
    this.announcements = this.announcements.filter((a) => a.timer > 0);

    for (const e of this.emotes) {
      e.timer -= dt;
    }
    this.emotes = this.emotes.filter((e) => e.timer > 0);
  }

  drawHUD(
    ctx: CanvasRenderingContext2D,
    state: RoundState,
    _localPlayerId: string,
    _particles: ParticleSystem
  ): void {
    const players = state.players;

    // Top-left: player stats (max 4, horizontal)
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const px = 4 + i * 64;
      const py = 4;

      // Background
      ctx.fillStyle = p.alive ? 'rgba(0,0,0,0.5)' : 'rgba(100,0,0,0.5)';
      ctx.fillRect(px, py, 60, 28);

      // Animal face (mini)
      ctx.fillStyle = p.alive ? PALETTE.green : PALETTE.red;
      ctx.fillRect(px + 2, py + 2, 8, 8);
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(px + 4, py + 4, 2, 2);

      // Nickname (truncated)
      ctx.fillStyle = PALETTE.white;
      ctx.font = '6px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(p.nickname.substring(0, 8), px + 12, py + 8);

      // Score
      ctx.fillStyle = PALETTE.yellow;
      ctx.fillText(`R:${p.score}`, px + 12, py + 15);

      // Stats
      ctx.fillStyle = PALETTE.lightGray;
      ctx.fillText(`S:${p.soaks}`, px + 2, py + 24);
      ctx.fillText(`C:${p.castlesWashed}`, px + 28, py + 24);
    }

    // Top-right: round timer
    const timerText = this.formatTimer(this.roundTimer);
    ctx.fillStyle = this.roundTimer < 600 ? PALETTE.red : PALETTE.white;
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(timerText, 250, 14);

    // Round info
    ctx.fillStyle = PALETTE.lightGray;
    ctx.font = '6px monospace';
    ctx.fillText(`Round ${this.roundNo}/${this.roundsToWin}`, 250, 22);

    // Ping
    ctx.fillStyle = this.ping > 150 ? PALETTE.red : PALETTE.lightGray;
    ctx.fillText(`${this.ping}ms`, 250, 30);

    // Kill feed (top center)
    ctx.textAlign = 'center';
    for (let i = 0; i < this.killFeed.length; i++) {
      const entry = this.killFeed[i];
      const alpha = Math.min(1, entry.timer / 0.5);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.fillText(entry.text, 128, 44 + i * 10);
    }
    ctx.globalAlpha = 1;

    // Chain announcements (center screen)
    for (const a of this.announcements) {
      ctx.save();
      ctx.translate(128, 80);
      ctx.scale(a.scale, a.scale);
      ctx.fillStyle = PALETTE.yellow;
      ctx.strokeStyle = PALETTE.black;
      ctx.lineWidth = 2;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.strokeText(a.text, 0, 0);
      ctx.fillText(a.text, 0, 0);
      ctx.restore();
    }

    // Emote bubbles above players
    for (const e of this.emotes) {
      const player = players.find((p) => p.playerId === e.playerId);
      if (!player || !player.alive) continue;
      // Position is calculated in game screen, but we don't have offset here
      // So we just draw at a fixed relative position or skip
      // The game screen will handle positioning of emotes above players
    }
  }

  drawEmoteBubble(
    ctx: CanvasRenderingContext2D,
    text: string,
    screenX: number,
    screenY: number
  ): void {
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(screenX - 10, screenY - 16, 20, 10);
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(screenX - 10, screenY - 16, 20, 1);
    ctx.fillRect(screenX - 10, screenY - 7, 20, 1);
    ctx.fillRect(screenX - 10, screenY - 16, 1, 10);
    ctx.fillRect(screenX + 9, screenY - 16, 1, 10);
    // Pointer
    ctx.fillRect(screenX - 2, screenY - 7, 4, 2);
    ctx.fillStyle = PALETTE.black;
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, screenX, screenY - 9);
  }

  private formatTimer(ticks: number): string {
    const seconds = Math.floor(ticks / CONFIG.TICK_RATE);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Draw small player icon (for results, etc.)
  drawPlayerIcon(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    x: number,
    y: number,
    size: number
  ): void {
    ctx.fillStyle = player.alive ? PALETTE.green : PALETTE.red;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(x + size / 3, y + size / 3, size / 3, size / 3);
  }
}
