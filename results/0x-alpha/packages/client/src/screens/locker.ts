import type { App } from "../main";
import { net } from "../net";
import { audio } from "../audio";
import { drawAnimal } from "../render/sprites";
import { CONFIG } from "@sc/shared";

const ANIMALS = [...CONFIG.unlocks.startAnimals, ...Object.keys(CONFIG.unlocks.animalsByLevel)];
const HATS = ["none", ...Object.keys(CONFIG.unlocks.hatsByLevel)];

export function showLocker(app: App): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2>LOCKER</h2>
    <div class="subtitle" id="lvl"></div>
    <canvas id="preview" width="64" height="64" style="image-rendering:pixelated;width:192px;height:192px;border:3px solid var(--ink)"></canvas>
    <div class="row" id="animals"></div>
    <div class="row" id="hats"></div>
    <button class="small" id="back">Back</button>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  if (!app.profile) {
    el.innerHTML = `<h2>LOCKER</h2><div class="muted">connecting…</div>`;
    return () => audio.stopMusic();
  }

  const p = app.profile;
  let animal = p.selectedAnimal;
  let hat: string | null = p.selectedHat;
  (el.querySelector("#lvl")!).textContent = `Level ${p.level} · ${p.xp}/${p.xpForNext} XP`;

  const unlockedAnimals = new Set([...p.unlocks.animals, ...CONFIG.unlocks.startAnimals]);
  const unlockedHats = new Set(["none", ...p.unlocks.hats]);

  const cv = el.querySelector("#preview") as HTMLCanvasElement;
  const ctx = cv.getContext("2d")!;
  let raf = 0;
  const drawPreview = (t: number): void => {
    ctx.fillStyle = "#29366f";
    ctx.fillRect(0, 0, 64, 64);
    drawAnimal(ctx, animal, hat === "none" ? null : hat, 24, 24, 2, Math.floor(t / 160) % 2 === 0 ? 0 : 1);
    raf = requestAnimationFrame(drawPreview);
  };
  raf = requestAnimationFrame(drawPreview);

  const push = (): void => net.send({ t: "select", animal, hat });

  const animalsDiv = el.querySelector("#animals")!;
  for (const a of ANIMALS) {
    const b = document.createElement("button");
    b.className = "small";
    const lvl = CONFIG.unlocks.animalsByLevel[a];
    const locked = !unlockedAnimals.has(a);
    b.textContent = locked ? `🔒 ${a} (Lv ${lvl})` : a;
    b.style.borderColor = a === animal ? "var(--accent)" : "";
    b.disabled = locked;
    b.addEventListener("click", () => {
      animal = a;
      push();
      audio.uiClick();
      for (const bb of animalsDiv.children) (bb as HTMLElement).style.borderColor = "";
      b.style.borderColor = "var(--accent)";
    });
    animalsDiv.appendChild(b);
  }
  const hatsDiv = el.querySelector("#hats")!;
  for (const h of HATS) {
    const b = document.createElement("button");
    b.className = "small";
    const lvl = CONFIG.unlocks.hatsByLevel[h];
    const locked = !unlockedHats.has(h);
    b.textContent = locked ? `🔒 ${h} (Lv ${lvl})` : h;
    b.style.borderColor = h === (hat ?? "none") ? "var(--accent)" : "";
    b.disabled = locked;
    b.addEventListener("click", () => {
      hat = h === "none" ? null : h;
      push();
      audio.uiClick();
      for (const bb of hatsDiv.children) (bb as HTMLElement).style.borderColor = "";
      b.style.borderColor = "var(--accent)";
    });
    hatsDiv.appendChild(b);
  }

  el.querySelector("#back")!.addEventListener("click", () => app.navigate("#/menu"));

  return () => {
    cancelAnimationFrame(raf);
    audio.stopMusic();
  };
}
