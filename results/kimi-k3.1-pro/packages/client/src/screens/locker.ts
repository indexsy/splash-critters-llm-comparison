import { CONFIG } from "@splash/shared";
import type { Animal, Hat } from "@splash/shared";
import { animalName, hatName, STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text } from "./ui.js";
import { drawAnimal } from "../render/sprites.js";

const ANIMALS = Object.keys(CONFIG.UNLOCKS.animals) as Animal[];
const HATS = Object.keys(CONFIG.UNLOCKS.hats) as Hat[];

export const lockerScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
  },
  render(app, time) {
    background(app, time);
    centered(app, STR.locker, 128, 9, "#f9dc5c", 13);
    if (!app.profile) {
      centered(app, STR.loading, 128, 100);
      return;
    }
    panel(app, 8, 30, 78, 101);
    centered(app, STR.equipped, 47, 36, "#8be9fd", 6);
    drawAnimal(app.canvas, app.profile.selectedAnimal, 47, 78, Math.floor(time / 170) % 2, app.profile.selectedHat, "right", false, 46);
    centered(app, animalName(app.profile.selectedAnimal), 47, 106, "#f9dc5c", 7);
    centered(app, hatName(app.profile.selectedHat), 47, 118, "#8a96bd", 6);
    text(app, STR.animals, 94, 29, "#8be9fd", 7);
    ANIMALS.forEach((animal, index) => {
      const required = CONFIG.UNLOCKS.animals[animal];
      const unlocked = app.profile?.unlocks.includes(`animal:${animal}`) ?? false;
      const selected = app.profile?.selectedAnimal === animal;
      const x = 92 + (index % 4) * 39;
      const y = 41 + Math.floor(index / 4) * 46;
      panel(app, x, y, 37, 43, selected ? "#3867d6" : unlocked ? "#182142" : "#10162f");
      drawAnimal(app.canvas, animal, x + 18, y + 18, Math.floor(time / 200 + index) % 2, "none", "down", false, 24);
      centered(app, unlocked ? animalName(animal).slice(0, 7) : `LV${required}`, x + 18, y + 34, unlocked ? "#f7f3d5" : "#8a96bd", 6);
      app.addHitRegion({ id: `animal-${animal}`, x, y, width: 37, height: 43, disabled: false, action: () => {
        if (!unlocked) return app.toastMessage(`${STR.unlockAt} ${required}`);
        app.net.send({ type: "set_cosmetics", animal, hat: app.profile?.selectedHat ?? "none" });
      } });
    });
    text(app, STR.hats, 10, 139, "#8be9fd", 7);
    HATS.forEach((hat, index) => {
      const required = CONFIG.UNLOCKS.hats[hat];
      const unlocked = app.profile?.unlocks.includes(`hat:${hat}`) ?? false;
      const selected = app.profile?.selectedHat === hat;
      const x = 8 + index * 49;
      const y = 151;
      panel(app, x, y, 46, 32, selected ? "#3867d6" : unlocked ? "#182142" : "#10162f");
      if (app.profile) drawAnimal(app.canvas, app.profile.selectedAnimal, x + 23, y + 14, 0, hat, "down", false, 22);
      centered(app, unlocked ? hatName(hat).split(" ")[0] : `LV${required}`, x + 23, y + 24, unlocked ? "#f7f3d5" : "#8a96bd", 5);
      app.addHitRegion({ id: `hat-${hat}`, x, y, width: 46, height: 32, disabled: false, action: () => {
        if (!unlocked) return app.toastMessage(`${STR.unlockAt} ${required}`);
        app.net.send({ type: "set_cosmetics", animal: app.profile?.selectedAnimal ?? "frog", hat });
      } });
    });
    button(app, "back", STR.back, 85, 193, 86, 18, () => app.go("menu"), { small: true });
  },
  key(app, code) {
    if (code === "Escape") app.go("menu");
    return true;
  }
};
