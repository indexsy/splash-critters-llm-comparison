// In-match HUD: player plates, round stars, ping, tide timer, kill feed,
// announcer pops.

import { CONFIG, type MatchPlayerInfo, type SnapshotPlayer } from "@splash/shared";
import { app } from "../app.js";
import { drawText, drawTextCentered, drawTextShadow, textWidth } from "./font.js";
import { PAL } from "./palette.js";
import { critterSprite } from "./sprites.js";

export interface FeedLine {
  text: string;
  color: string;
  until: number;
}

export interface Announcement {
  text: string;
  color: string;
  until: number;
  scale: number;
}

export class Hud {
  feed: FeedLine[] = [];
  announcements: Announcement[] = [];

  addFeed(text: string, color: string = PAL.white): void {
    this.feed.push({ text, color, until: performance.now() + 4200 });
    if (this.feed.length > 4) this.feed.shift();
  }

  announce(text: string, color: string = PAL.white, scale = 2, ms = 1300): void {
    this.announcements.push({ text, color, until: performance.now() + ms, scale });
    if (this.announcements.length > 2) this.announcements.shift();
  }

  clear(): void {
    this.feed = [];
    this.announcements = [];
  }

  drawTop(
    g: CanvasRenderingContext2D,
    players: MatchPlayerInfo[],
    snap: SnapshotPlayer[] | null,
    scores: number[],
    roundsToWin: number,
    tick: number
  ): void {
    g.fillStyle = PAL.black;
    g.fillRect(0, 0, 256, 16);
    const plateW = Math.floor(256 / Math.max(2, players.length));
    players.forEach((p, i) => {
      const x = i * plateW;
      const sp = snap?.find((s) => s.slot === p.slot);
      const alive = sp?.alive ?? true;
      // mini portrait
      const sprite = critterSprite(p.animal, p.hat, 0, 3);
      g.globalAlpha = alive ? 1 : 0.4;
      g.drawImage(sprite, 0, 0, 16, 16, x + 1, 2, 12, 12);
      // name
      const name = p.nickname.split("#")[0].slice(0, 8);
      drawText(g, name, x + 15, 2, alive ? PAL.white : PAL.gray);
      // round stars
      for (let s = 0; s < roundsToWin; s++) {
        g.fillStyle = s < (scores[p.slot] ?? 0) ? PAL.gold : PAL.darkgray;
        g.fillRect(x + 15 + s * 4, 9, 3, 3);
      }
      // live stat pips (balloons / range / speed)
      if (sp && alive) {
        const statX = x + 15 + roundsToWin * 4 + 3;
        drawText(g, `${sp.balloonCount}`, statX, 9, PAL.waterLight);
        drawText(g, `${sp.splashRange}`, statX + 8, 9, PAL.gold);
        if (sp.hasKick) drawText(g, "K", statX + 16, 9, PAL.red);
      }
      g.globalAlpha = 1;
    });
  }

  drawTideTimer(g: CanvasRenderingContext2D, tick: number, tideRing: number): void {
    const ticksLeft = CONFIG.TIDE_START_TICKS - tick;
    if (tideRing > 0) {
      if (Math.floor(performance.now() / 300) % 2 === 0) {
        drawTextCentered(g, "RISING TIDE!", 128, 18, PAL.waterLight);
      }
      return;
    }
    if (ticksLeft <= 0) return;
    const secs = Math.ceil(ticksLeft / CONFIG.TICK_RATE);
    const m = Math.floor(secs / 60);
    const s = String(secs % 60).padStart(2, "0");
    const warn = secs <= 15;
    drawTextCentered(g, `${m}:${s}`, 128, 18, warn && Math.floor(performance.now() / 300) % 2 === 0 ? PAL.red : PAL.gray);
  }

  drawFeed(g: CanvasRenderingContext2D): void {
    const now = performance.now();
    this.feed = this.feed.filter((f) => f.until > now);
    this.feed.forEach((f, i) => {
      const alpha = Math.min(1, (f.until - now) / 800);
      g.globalAlpha = alpha;
      const w = textWidth(f.text) + 4;
      g.fillStyle = "rgba(15,15,27,0.7)";
      g.fillRect(254 - w, 26 + i * 9, w, 8);
      drawText(g, f.text, 256 - w, 27 + i * 9, f.color);
      g.globalAlpha = 1;
    });
  }

  drawAnnouncements(g: CanvasRenderingContext2D): void {
    const now = performance.now();
    this.announcements = this.announcements.filter((a) => a.until > now);
    this.announcements.forEach((a, i) => {
      const remain = a.until - now;
      const pop = remain > 1000 ? 1 + Math.min(0.4, (1300 - remain) / 400) : 1;
      const scale = Math.max(1, Math.round(a.scale * pop));
      drawTextShadow(
        g,
        a.text,
        Math.round(128 - textWidth(a.text, scale) / 2),
        Math.round(100 - i * 20 - (scale * 5) / 2),
        a.color,
        scale
      );
    });
  }

  drawPing(g: CanvasRenderingContext2D): void {
    const ping = app.pingMs;
    const color = ping < 80 ? PAL.green : ping < 160 ? PAL.gold : PAL.red;
    drawText(g, `${ping}MS`, 2, 217, color);
  }
}
