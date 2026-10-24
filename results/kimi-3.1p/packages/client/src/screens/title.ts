import { STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text } from "./ui.js";
import { drawAnimal, drawBalloon } from "../render/sprites.js";
import type { BalloonState } from "@splash/shared";

function primary(app: App): void {
  if (app.profile?.tutorialComplete) app.go("menu");
  else app.startTutorial();
}

export const titleScreen: Screen = {
  enter(app) {
    app.audio.setTrack("title");
  },
  render(app, time) {
    background(app, time, true);
    const bounce = Math.round(Math.sin(time / 280) * 3);
    centered(app, STR.appName, 128, 34 + bounce, "#f9dc5c", 19);
    centered(app, STR.tagline, 128, 61, "#8be9fd", 8);
    const animals = ["frog", "duck", "otter", "capybara"] as const;
    animals.forEach((animal, index) => drawAnimal(app.canvas, animal, 52 + index * 51, 105 + Math.sin(time / 250 + index) * 4, Math.floor(time / 180 + index) % 2, index === 3 ? "crown" : index === 1 ? "bucket" : "none", "down", false, 24));
    const balloon: BalloonState = { id: 1, ownerId: "", x: 0, y: 0, fuse: 45, range: 2, passThrough: [], kickDir: null, direction: "down", kickProgress: 0, straight: false, revenge: false };
    drawBalloon(app.canvas, balloon, 22, 92, 14, time);
    drawBalloon(app.canvas, balloon, 220, 92, 14, time + 200);
    if (!app.profile) {
      panel(app, 54, 140, 148, 18);
      centered(app, STR.loading, 128, 146, "#8be9fd", 7);
    } else {
      centered(app, STR.pressStart, 128, 143, Math.floor(time / 450) % 2 ? "#f7f3d5" : "#8a96bd", 8);
    }
    button(app, "play", app.profile?.tutorialComplete ? STR.play : STR.tutorial, 77, 158, 102, 18, () => primary(app), { disabled: !app.profile });
    button(app, "howto", STR.howToPlay, 28, 183, 94, 16, () => app.go("howto"), { small: true });
    button(app, "settings", STR.settings, 134, 183, 94, 16, () => app.go("settings"), { small: true });
    centered(app, STR.demo, 128, 211, "#4c5d95", 6);
  },
  key(app, code) {
    if (code === "Enter" && app.profile) primary(app);
    if (code === "KeyT") app.startTutorial();
    return true;
  }
};
