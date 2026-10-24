import { CONFIG } from "@splash/shared";
import { STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, formatClock, panel } from "./ui.js";

function cancel(app: App): void {
  app.net.send({ type: "queue_leave" });
  app.queueMode = null;
  app.go("menu");
}

export const queueScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
  },
  render(app, time) {
    background(app, time);
    centered(app, STR.searching, 128, 34, "#f9dc5c", 12);
    centered(app, app.queueMode === "ffa" ? STR.rankedFfa : STR.rankedDuel, 128, 55, "#8be9fd", 8);
    const dots = ".".repeat(Math.floor(time / 400) % 4);
    centered(app, dots, 128, 70, "#f7f3d5", 12);
    panel(app, 48, 88, 160, 70);
    const elapsed = (performance.now() - app.queueJoinedAt) / 1000;
    centered(app, `${STR.elapsed}: ${formatClock(elapsed)}`, 128, 99);
    centered(app, `${STR.searchRange}: ±${app.queueSearchRange}`, 128, 115, "#8be9fd");
    centered(app, `${STR.estimatedWait}: ${app.queueEta}${STR.seconds}`, 128, 131, "#8a96bd", 7);
    centered(app, `${STR.inQueue}: ${app.queuePlayers}`, 128, 145, "#8a96bd", 7);
    const widening = Math.floor(elapsed * 1000 / CONFIG.MATCHMAKING.WIDEN_MS) * CONFIG.MATCHMAKING.WIDEN_STEP;
    if (widening > 0) centered(app, `+${Math.min(widening, CONFIG.MATCHMAKING.MAX_RANGE - CONFIG.MATCHMAKING.INITIAL_RANGE)} WIDENING`, 128, 166, "#56e39f", 7);
    button(app, "cancel", STR.cancelQueue, 73, 181, 110, 18, () => cancel(app), { color: "#d64550" });
  },
  key(app, code) {
    if (code === "Escape") cancel(app);
    return true;
  }
};
