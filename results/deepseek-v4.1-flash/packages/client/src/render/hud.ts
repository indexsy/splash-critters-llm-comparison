import type { AnimalId, HatId, MatchConfig } from "@splash/shared";
import { COLORS, drawPanel, drawProgress, drawTierBadge } from "../ui.js";
import { drawText, drawTextCentered, textWidth } from "./font.js";
import { drawAnimal, drawHeart } from "./sprites.js";

export interface HudPlayer {
  id: string;
  name: string;
  animal: AnimalId;
  hat: HatId;
  alive: boolean;
  score: number;
  isBot: boolean;
  level: number;
  tier?: string;
}

export interface FeedLine {
  text: string;
  age: number;
  tone: "normal" | "soak" | "chain" | "tide" | "gold";
}

function shortName(name: string, max = 8): string {
  const base = name.split("#")[0] ?? name;
  return base.length > max ? `${base.slice(0, max - 1)}.` : base;
}

export function drawMatchHud(
  ctx: CanvasRenderingContext2D,
  config: MatchConfig,
  players: HudPlayer[],
  localId: string,
  rtt: number,
  time: number,
): void {
  ctx.fillStyle = "rgba(3, 14, 21, 0.9)";
  ctx.fillRect(0, 0, 256, 21);
  ctx.fillStyle = "#1c5263";
  ctx.fillRect(0, 20, 256, 1);
  const count = Math.max(1, players.length);
  const gap = 4;
  const width = Math.floor((252 - gap * (count - 1)) / count);
  players.slice(0, 4).forEach((player, index) => {
    const x = 2 + index * (width + gap);
    const isLocal = player.id === localId;
    ctx.fillStyle = isLocal ? "rgba(46, 196, 182, 0.16)" : "rgba(8, 35, 49, 0.75)";
    ctx.fillRect(x, 1, width, 18);
    if (isLocal) {
      ctx.fillStyle = COLORS.mint;
      ctx.fillRect(x, 1, width, 1);
    }
    ctx.globalAlpha = player.alive ? 1 : 0.42;
    drawAnimal(ctx, {
      animal: player.animal,
      hat: player.hat,
      x: x + 1,
      y: -1,
      scale: 0.75,
      time,
      noHat: width < 54,
    });
    ctx.globalAlpha = 1;
    const scoreText = `${player.score}`;
    const scoreWidth = textWidth(scoreText);
    drawText(ctx, scoreText, x + width - scoreWidth - 3, 3, COLORS.yellow);
    const nameLimit = Math.max(4, Math.min(count > 2 ? 8 : 12, Math.floor((width - 18 - scoreWidth) / 6)));
    drawText(
      ctx,
      shortName(player.name, nameLimit),
      x + 13,
      3,
      player.alive ? COLORS.foam : "#6c8994",
    );
    if (!player.alive) {
      ctx.fillStyle = COLORS.coral;
      ctx.fillRect(x + width - 9, 12, 1, 1);
      ctx.fillRect(x + width - 7, 12, 1, 1);
      ctx.fillRect(x + width - 8, 13, 1, 1);
    } else {
      drawHeart(ctx, x + width - 9, 12, true, 1);
    }
    if (player.isBot) drawText(ctx, "BOT", x + 14, 11, "#688b99", 1);
    else if (isLocal) drawText(ctx, `${Math.max(0, Math.round(rtt))}MS`, x + 14, 11, "#6fa9b6", 1);
    else if (player.tier) drawTierBadge(ctx, player.tier, x + 14, 12, 1);
  });
}

export function drawFeed(ctx: CanvasRenderingContext2D, feed: FeedLine[]): void {
  feed.slice(-4).forEach((line, index, all) => {
    const alpha = Math.max(0, Math.min(1, 1 - (line.age - 3) / 2));
    if (alpha <= 0) return;
    const y = 27 + (all.length - index - 1) * 9;
    ctx.globalAlpha = alpha;
    const color =
      line.tone === "soak"
        ? COLORS.coral
        : line.tone === "chain"
          ? COLORS.yellow
          : line.tone === "tide"
            ? "#57c7ff"
            : line.tone === "gold"
              ? COLORS.orange
              : COLORS.foam;
    const width = textWidth(line.text) + 6;
    ctx.fillStyle = "rgba(3, 13, 20, 0.65)";
    ctx.fillRect(248 - width, y - 1, width, 9);
    drawText(ctx, line.text, 251 - width, y, color);
    ctx.globalAlpha = 1;
  });
}

export function drawAnnouncement(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string | null,
  color = COLORS.yellow,
  scale = 2,
): void {
  const y = 84;
  ctx.fillStyle = "rgba(3, 12, 18, 0.58)";
  ctx.fillRect(0, y - 8, 256, 30);
  drawTextCentered(ctx, title, 128, y, color, scale, "#102533");
  if (subtitle) drawTextCentered(ctx, subtitle, 128, y + 14 * scale, COLORS.foam);
}

export function drawCountdown(
  ctx: CanvasRenderingContext2D,
  value: string,
  progress: number,
  time: number,
): void {
  ctx.fillStyle = "rgba(3, 13, 20, 0.36)";
  ctx.fillRect(0, 0, 256, 224);
  const pulse = 1 + Math.sin(time * 16) * 0.05;
  const size = Math.round(2 * pulse);
  ctx.globalAlpha = 0.3;
  drawTextCentered(ctx, value, 128, 78, COLORS.teal, 4);
  ctx.globalAlpha = 1;
  drawTextCentered(ctx, value, 128, 80, COLORS.foam, size, "#0a2a38");
  drawProgress(ctx, 88, 120, 80, 5, progress, COLORS.teal);
  drawTextCentered(ctx, "GET READY TO SPLASH", 128, 132, COLORS.mint);
}

export function drawEmote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  id: number,
): void {
  const icons = ["QUACK", "RIB", "SQUEAK", "HONK"];
  const label = icons[id - 1] ?? "!";
  const width = textWidth(label, 1) + 10;
  const bx = Math.round(x - width / 2);
  const by = Math.max(24, Math.round(y - 18));
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(bx + 1, by, width - 2, 12);
  ctx.fillRect(bx, by + 1, width, 10);
  ctx.fillStyle = COLORS.foam;
  ctx.fillRect(bx + 2, by + 1, width - 4, 10);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(bx + 4, by + 11, 2, 1);
  drawText(ctx, label, bx + 5, by + 3, COLORS.ink);
}

export function drawVSIntro(
  ctx: CanvasRenderingContext2D,
  config: MatchConfig,
  time: number,
): void {
  const pulse = Math.floor(time * 3) % 2;
  ctx.fillStyle = "rgba(3, 12, 18, 0.72)";
  ctx.fillRect(0, 0, 256, 224);
  ctx.fillStyle = "#0d3445";
  ctx.fillRect(8, 38, 240, 148);
  ctx.strokeStyle = pulse ? COLORS.teal : "#1f6478";
  ctx.strokeRect(8.5, 38.5, 239, 147);
  drawTextCentered(ctx, config.ranked ? "RANKED BATTLE" : "CASUAL SPLASH", 128, 47, COLORS.mint);
  drawTextCentered(ctx, config.theme.toUpperCase(), 128, 174, "#7cbec8");
  drawTextCentered(ctx, `${config.mode === "duel" ? "DUEL" : "FREE-FOR-ALL"}  /  FIRST TO ${config.roundsToWin}`, 128, 183, "#7cbec8");
  const shown = config.players.slice(0, 4);
  const slotWidth = 220 / Math.max(2, shown.length);
  shown.forEach((player, index) => {
    const cx = 18 + slotWidth * index + slotWidth / 2;
    drawAnimal(ctx, {
      animal: player.animal,
      hat: player.hat,
      x: cx - 14,
      y: 78 + (index % 2) * 2,
      scale: 2,
      time: time + index,
    });
    const name = (player.name.split("#")[0] ?? player.name).slice(0, 11).toUpperCase();
    drawTextCentered(ctx, name, cx, 114, COLORS.foam);
    if (config.ranked && player.rating !== undefined) {
      drawTextCentered(ctx, `${Math.round(player.rating)}`, cx, 124, COLORS.yellow);
      drawTierBadge(ctx, player.tier ?? "POND", Math.round(cx - textWidth(player.tier ?? "POND") / 2), 134, 1);
    } else {
      drawTextCentered(ctx, player.isBot ? "BOT" : `LV ${player.level ?? 1}`, cx, 125, "#8ab6c0");
    }
  });
  if (shown.length === 2) {
    drawTextCentered(ctx, "VS", 128, 104, COLORS.coral, 2, "#102533");
  }
}

export function drawRoundEnd(
  ctx: CanvasRenderingContext2D,
  winnerName: string | null,
  draw: boolean,
  roundNo: number,
  scores: Record<string, number>,
  localId: string,
  players: HudPlayer[],
): void {
  ctx.fillStyle = "rgba(3, 13, 20, 0.76)";
  ctx.fillRect(0, 0, 256, 224);
  drawPanel(ctx, 28, 44, 200, 132);
  drawTextCentered(ctx, draw ? "DOUBLE SOAK!" : "ROUND WON!", 128, 55, draw ? COLORS.yellow : COLORS.mint, 2);
  drawTextCentered(
    ctx,
    draw ? "EVERYONE GOT WET" : `${(winnerName ?? "NOBODY").split("#")[0]?.toUpperCase() ?? "NOBODY"} IS DRY`,
    128,
    78,
    COLORS.foam,
  );
  drawTextCentered(ctx, `ROUND ${roundNo} COMPLETE`, 128, 90, "#77a6b2");
  players.forEach((player, index) => {
    const y = 104 + index * 12;
    const local = player.id === localId;
    drawText(ctx, `${local ? ">" : " "} ${shortName(player.name, 14)}`, 46, y, local ? COLORS.mint : COLORS.foam);
    drawText(ctx, `${scores[player.id] ?? 0}`, 208, y, COLORS.yellow);
  });
}

export function drawControlsHint(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = "rgba(3, 13, 20, 0.7)";
  ctx.fillRect(0, 216, 256, 8);
  drawTextCentered(ctx, text, 128, 217, "#75a9b4");
}
