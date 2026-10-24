import { STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text } from "./ui.js";
import { drawAnimal, drawBalloon, drawPowerup } from "../render/sprites.js";
import type { BalloonState } from "@splash/shared";

export const howToScreen: Screen = {
  render(app, time) {
    background(app, time, true);
    centered(app, STR.howToPlay, 128, 10, "#f9dc5c", 13);
    panel(app, 10, 31, 236, 158);
    const lines = [STR.howMove, STR.howDrop, STR.howEmotes, STR.howMute, STR.howSplash, STR.howChain, STR.howPowerups, STR.howKick, STR.howTide, STR.howRevenge];
    lines.forEach((line, index) => text(app, line, 17, 39 + index * 14, index < 4 ? "#f9dc5c" : index > 7 ? "#ff9aa2" : "#f7f3d5", index >= 4 ? 5 : 7));
    drawAnimal(app.canvas, "frog", 24, 201, Math.floor(time / 180) % 2, "bucket", "right", false, 18);
    drawPowerup(app.canvas, "speed", 47, 194, 14, time);
    const balloon: BalloonState = { id: 1, ownerId: "", x: 0, y: 0, fuse: 45, range: 2, passThrough: [], kickDir: null, direction: "down", kickProgress: 0, straight: false, revenge: false };
    drawBalloon(app.canvas, balloon, 70, 194, 14, time);
    button(app, "tutorial", STR.tutorial, 94, 195, 86, 18, () => app.startTutorial());
    button(app, "back", STR.back, 184, 195, 62, 18, () => app.go("menu"), { small: true });
  },
  key(app, code) {
    if (code === "Escape") app.go("menu");
    return true;
  }
};
