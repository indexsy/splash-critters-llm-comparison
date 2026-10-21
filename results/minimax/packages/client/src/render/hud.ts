import { CONFIG, type AnimalId, type HatId, type Theme } from '@splash-critters/shared';
import { drawAnimalIcon, drawHat, PALETTE } from './sprites.js';
import { drawText, textWidth } from './font.js';

export interface HudPlayer {
  id: number;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  roundWins: number;
  alive: boolean;
  soaks: number;
  ping: number;
}

export interface HudOptions {
  players: HudPlayer[];
  localId: number;
  timeLeft: number;
  roundNo: number;
  roundsToWin: number;
  tideRing: number;
  killFeed: { text: string; color: string; until: number }[];
  announcements: { text: string; sub: string; color: string; until: number }[];
  countdown: number;
  theme: Theme;
  balloons: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  colorblind: boolean;
}

export function drawHud(ctx: CanvasRenderingContext2D, options: HudOptions): void {
  const { players, localId } = options;

  // top bar
  ctx.fillStyle = 'rgba(9,15,30,0.82)';
  ctx.fillRect(0, 0, 256, 22);

  let x = 3;
  for (const player of players) {
    const isLocal = player.id === localId;
    const width = 62;
    ctx.fillStyle = isLocal ? 'rgba(42,157,143,0.45)' : 'rgba(22,33,62,0.8)';
    ctx.fillRect(x, 2, width, 18);
    ctx.strokeStyle = isLocal ? PALETTE.mint : 'rgba(0,0,0,0.5)';
    ctx.strokeRect(x + 0.5, 2.5, width - 1, 17);
    drawAnimalIcon(ctx, player.animal, x + 1, 4, 0);
    drawHat(ctx, player.hat, x + 1, 4);
    drawText(ctx, player.nickname.slice(0, 8).toUpperCase(), x + 14, 5, {
      color: player.alive ? PALETTE.white : 'rgba(253,246,227,0.45)',
    });
    drawText(ctx, `#${player.tag}`, x + 14, 13, { color: PALETTE.sky });
    // round score pips
    for (let i = 0; i < options.roundsToWin; i++) {
      ctx.fillStyle = i < player.roundWins ? PALETTE.yellow : 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + width - 12 + i * 3, 5, 2, 4);
    }
    ctx.fillStyle = player.alive ? PALETTE.mint : PALETTE.pink;
    ctx.fillRect(x + width - 12, 12, 2, 2);
    ctx.fillRect(x + width - 9, 12, 2, 2);
    x += width + 2;
  }

  // timer
  const seconds = Math.max(0, Math.ceil(options.timeLeft / CONFIG.TICK_RATE));
  const timeText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  ctx.fillStyle = 'rgba(9,15,30,0.85)';
  ctx.fillRect(100, 24, 56, 12);
  drawText(ctx, `R${options.roundNo}`, 103, 27, { color: PALETTE.sky });
  drawText(ctx, timeText, 153, 27, {
    align: 'right',
    color: options.tideRing >= 0 ? PALETTE.sky : PALETTE.white,
  });

  // local stats
  ctx.fillStyle = 'rgba(9,15,30,0.7)';
  ctx.fillRect(2, 202, 96, 20);
  drawText(ctx, `BALLOONS ${options.balloons}/${options.balloonCount}`, 5, 204, {
    color: options.balloons >= options.balloonCount ? PALETTE.pink : PALETTE.white,
  });
  drawText(ctx, `SPLASH ${options.splashRange}`, 5, 212, { color: PALETTE.waterLight });
  if (options.hasBoots) drawText(ctx, 'BOOTS READY', 60, 212, { color: PALETTE.mint });

  // kill feed
  let feedY = 40;
  for (const entry of options.killFeed) {
    const width = textWidth(entry.text);
    ctx.fillStyle = 'rgba(9,15,30,0.7)';
    ctx.fillRect(256 - width - 6, feedY - 1, width + 4, 9);
    drawText(ctx, entry.text, 252, feedY, { align: 'right', color: entry.color });
    feedY += 10;
  }

  // announcements
  let announceY = 96;
  for (const announcement of options.announcements) {
    const width = textWidth(announcement.text) + 8;
    ctx.fillStyle = 'rgba(9,15,30,0.8)';
    ctx.fillRect(128 - width / 2, announceY - 4, width, 16);
    drawText(ctx, announcement.text, 128, announceY, {
      align: 'center',
      color: announcement.color,
      shadow: PALETTE.ink,
    });
    if (announcement.sub) {
      drawText(ctx, announcement.sub, 128, announceY + 9, {
        align: 'center',
        color: 'rgba(253,246,227,0.75)',
      });
    }
    announceY += 26;
  }

  // countdown
  if (options.countdown > 0 && options.countdown <= 90) {
    const value = Math.ceil(options.countdown / CONFIG.TICK_RATE);
    const label = value > 0 ? String(value) : 'SPLASH!';
    ctx.fillStyle = 'rgba(9,15,30,0.65)';
    ctx.fillRect(0, 0, 256, 224);
    drawText(ctx, label, 128, 96, {
      align: 'center',
      color: PALETTE.yellow,
      shadow: PALETTE.ink,
      scale: value > 0 ? 4 : 2,
    });
  }
}
