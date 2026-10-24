import { STR, animalName } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text, truncate, xpBar } from "./ui.js";
import { drawAnimal } from "../render/sprites.js";

let enteredAt = 0;

export const resultsScreen: Screen = {
  enter(app) {
    enteredAt = performance.now();
    app.audio.setTrack("results");
    const own = app.results?.placements.find((placement) => placement.playerId === app.localPlayerId);
    if (own?.placement === 1) {
      app.audio.play("victory");
      app.particles.confetti();
    }
  },
  render(app, time) {
    background(app, time);
    const results = app.results;
    if (!results) {
      centered(app, STR.waiting, 128, 100);
      return;
    }
    const own = results.placements.find((placement) => placement.playerId === app.localPlayerId);
    centered(app, own?.placement === 1 ? STR.victory : STR.results, 128, 8, own?.placement === 1 ? "#f9dc5c" : "#8be9fd", 14);
    results.placements.slice(0, 4).forEach((placement, index) => {
      const y = 31 + index * 25;
      panel(app, 8, y, 240, 22, placement.playerId === app.localPlayerId ? "#29345d" : "#182142");
      text(app, `#${placement.placement}`, 13, y + 7, placement.placement === 1 ? "#f9dc5c" : "#8a96bd", 8);
      drawAnimal(app.canvas, placement.animal, 39, y + 12, Math.floor(time / 180 + index) % 2, "none", "down", false, 16);
      text(app, truncate(app, placement.nickname, 91), 52, y + 4, placement.playerId === app.localPlayerId ? "#f9dc5c" : "#f7f3d5", 7);
      text(app, `${placement.roundWins}★ ${placement.soaks} ${STR.soaks}`, 52, y + 13, "#8a96bd", 6);
      if (placement.ratingBefore !== null && placement.ratingAfter !== null) text(app, `${placement.ratingBefore} → ${placement.ratingAfter}`, 158, y + 7, "#8be9fd", 7);
      else text(app, `+${placement.xpEarned} ${STR.xp}`, 190, y + 7, "#56e39f", 7);
    });
    const stats = [
      [STR.mostSoaks, results.funStats.mostSoaks],
      [STR.castleCrusher, results.funStats.castleCrusher],
      [STR.longestSurvivor, results.funStats.longestSurvivor],
      [STR.biggestChain, results.funStats.biggestChain]
    ] as const;
    stats.forEach(([label, playerId], index) => {
      const player = results.placements.find((placement) => placement.playerId === playerId);
      const x = index % 2 === 0 ? 12 : 135;
      const y = 137 + Math.floor(index / 2) * 13;
      text(app, label, x, y, "#8a96bd", 6);
      text(app, truncate(app, player?.nickname.split("#")[0] ?? "—", 65), x, y + 6, "#8be9fd", 6);
    });
    if (app.profile && own) {
      const progress = Math.min(1, (time - enteredAt) / 1400);
      const shown = Math.floor(app.resultsBaseXp + (app.profile.xp - app.resultsBaseXp) * progress);
      text(app, `${STR.level} ${app.profile.level}`, 13, 169, "#f9dc5c", 7);
      xpBar(app, 58, 169, 185, app.profile.xp, app.profile.level, shown);
      const delta = results.ratingDeltas[app.localPlayerId];
      if (delta !== undefined) text(app, `${STR.rating}: ${delta >= 0 ? "+" : ""}${delta}`, 128, 180, delta >= 0 ? "#56e39f" : "#ff858d", 7, "center");
    }
    if (!app.matchConfig?.ranked) button(app, "rematch", STR.rematch, 8, 194, 116, 20, () => app.net.send({ type: "rematch_vote", vote: true }), { color: "#56e39f" });
    else button(app, "leaderboard", STR.leaderboard, 8, 194, 116, 20, () => app.go("leaderboard"));
    button(app, "continue", STR.continue, 132, 194, 116, 20, () => app.continueAfterResults());
  },
  key(app, code) {
    if (code === "Enter") app.continueAfterResults();
    return true;
  }
};
