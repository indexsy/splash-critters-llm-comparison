import type { GameState } from "@splash/shared";
import type { App } from "../main.js";
import { formatClock, panel, text, truncate } from "../screens/ui.js";
import { drawAnimal } from "./sprites.js";

const TIER_COLORS: Record<string, string> = { Puddle: "#8a96bd", Pond: "#56e39f", River: "#38bdf8", Lake: "#3867d6", Ocean: "#9b7ede", Tsunami: "#f9dc5c" };

export function drawHud(app: App, state: GameState): void {
  const count = state.players.length;
  const width = count === 2 ? 124 : 62;
  state.players.forEach((player, index) => {
    const x = count === 2 ? index * 128 + 2 : index * 63 + 1;
    panel(app, x, 2, width, 29, player.alive ? "#182142" : "#40243b");
    drawAnimal(app.canvas, player.animal, x + 9, 16, Math.floor(performance.now() / 180) % 2, player.hat, player.dir, !player.alive, 12);
    const name = count === 2 ? truncate(app, player.nickname, 75) : truncate(app, player.nickname.split("#")[0], 42);
    text(app, name, x + 18, 5, player.id === app.localPlayerId ? "#f9dc5c" : "#f7f3d5", 7);
    const stats = `B${player.balloonCount} R${player.splashRange} S${player.speed.toFixed(1)}`;
    text(app, stats, x + 18, 14, "#8be9fd", 6);
    text(app, `${player.roundsWon}★`, x + 4, 23, "#f9dc5c", 7);
    if (!player.bot || count === 2) text(app, `${player.ping}ms`, x + width - 27, 23, "#8a96bd", 6);
    if (!player.alive) text(app, "OUT", x + width - 22, 14, "#ff858d", 6);
  });
  const roundTick = Math.max(0, state.tick - state.roundStartedTick);
  text(app, formatClock(roundTick / 30), 128, 31, roundTick > 3300 ? "#ff858d" : "#f7f3d5", 6, "center");
}

export function drawKillFeed(app: App): void {
  const now = performance.now();
  app.feed = app.feed.filter((entry) => entry.until > now);
  app.feed.slice(-3).forEach((entry, index) => {
    const width = Math.min(248, app.canvas.measureText(entry.text).width + 10);
    panel(app, 252 - width, 196 - index * 11, width, 10, "#10162fdd");
    text(app, entry.text, 248, 198 - index * 11, entry.color, 6, "right");
  });
}

export function announce(app: App, value: string, subtitle = "", color = "#f9dc5c"): void {
  const width = Math.max(110, Math.min(230, value.length * 8 + 20));
  panel(app, 128 - width / 2, 82, width, subtitle ? 46 : 30, "#182142ee");
  text(app, value, 128, 91, color, value.length > 18 ? 10 : 13, "center");
  if (subtitle) text(app, subtitle, 128, 113, "#8be9fd", 7, "center");
}

export function drawTierBadge(app: App, tier: string, x: number, y: number, width = 42): void {
  app.canvas.fillStyle = TIER_COLORS[tier] ?? TIER_COLORS.Puddle;
  app.canvas.fillRect(x, y, width, 10);
  text(app, tier.toUpperCase(), x + width / 2, y + 2, "#10162f", 6, "center");
}
