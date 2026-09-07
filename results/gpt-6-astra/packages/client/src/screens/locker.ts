import { CONFIG, levelProgress } from "@splash/shared";
import { button, icon, pageHeading, portrait, type UIState } from "../ui.js";
export function lockerScreen(state: UIState): string {
  const p = state.profile;
  const progress = levelProgress(p?.xp ?? 0);
  return `${pageHeading("LOOK GOOD. GET SOAKED.", "Your Critter Closet.", "Every look is earned. Every critter is equally splashable.")}<div class="locker-layout"><aside class="locker-preview"><div class="eyebrow">YOUR CURRENT VIBE</div><canvas id="locker-preview" width="64" height="64" aria-label="Live animated preview of your selected critter"></canvas><h2>${CONFIG.ANIMALS.find((a) => a.id === p?.selectedAnimal)?.name ?? "Frog"}</h2><p>${CONFIG.HATS.find((h) => h.id === p?.selectedHat)?.name ?? "Just me"}</p><span class="level-pill">LEVEL ${progress.level}</span><div class="xp-track"><span style="width:${(progress.current / progress.required) * 100}%"></span></div><small>${progress.current} / ${progress.required} XP</small><div class="locker-note">${icon("lock", 17)} All cosmetic. Always fair.</div></aside><section class="closet"><div class="section-line"><h2>CHOOSE YOUR CRITTER</h2><span>8 very different ways to get wet.</span></div><div class="cosmetic-grid">${CONFIG.ANIMALS.map(
    (a) => {
      const unlocked = p?.unlocks.includes(a.id);
      return `<button data-action="equip-animal" data-id="${a.id}" class="cosmetic ${p?.selectedAnimal === a.id ? "selected" : ""} ${!unlocked ? "locked" : ""}" ${!unlocked ? "disabled" : ""}>${portrait(a.id)}<strong>${a.name}</strong><small>${unlocked ? (p?.selectedAnimal === a.id ? "EQUIPPED" : "UNLOCKED") : `${a.level === 20 ? "THE BIG FLEX / " : ""}LEVEL ${a.level}`}</small>${!unlocked ? icon("lock", 12) : ""}</button>`;
    },
  ).join(
    "",
  )}</div><div class="section-line"><h2>A LITTLE SOMETHING ON TOP</h2><span>Hats off. Or on.</span></div><div class="cosmetic-grid hats">${CONFIG.HATS.map(
    (h) => {
      const unlocked = p?.unlocks.includes(h.id);
      return `<button data-action="equip-hat" data-id="${h.id}" class="cosmetic ${p?.selectedHat === h.id ? "selected" : ""} ${!unlocked ? "locked" : ""}" ${!unlocked ? "disabled" : ""}>${portrait(p?.selectedAnimal ?? "frog", h.id)}<strong>${h.name}</strong><small>${unlocked ? (p?.selectedHat === h.id ? "EQUIPPED" : "UNLOCKED") : `LEVEL ${h.level}`}</small></button>`;
    },
  ).join(
    "",
  )}</div></section></div><div class="subtle-note">${button("Earn a Little More XP", "practice", "text")} Participation, placements, soaks, and washed castles all count.</div>`;
}
