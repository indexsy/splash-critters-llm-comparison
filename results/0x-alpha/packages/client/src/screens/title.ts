import type { App } from "../main";
import { audio } from "../audio";

export function showTitle(app: App): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h1>SPLASH CRITTERS</h1>
    <div class="subtitle">an 8-bit water balloon battler</div>
    <canvas id="titlePreview" width="128" height="48" style="image-rendering:pixelated;width:384px;height:144px;border:3px solid var(--panel);"></canvas>
    <button class="primary" id="startBtn">PRESS START</button>
    <div class="muted">WASD / arrows to move · Space to drop · 1-4 emotes · M mute</div>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  // animated critter parade
  const cv = el.querySelector("#titlePreview") as HTMLCanvasElement;
  const ctx = cv.getContext("2d")!;
  let raf = 0;
  const animals = ["frog", "duck", "otter", "penguin"];
  const draw = (t: number): void => {
    ctx.fillStyle = "#1a1c2c";
    ctx.fillRect(0, 0, 128, 48);
    ctx.fillStyle = "#41a6f6";
    ctx.fillRect(0, 40, 128, 8);
    for (let i = 0; i < 4; i++) {
      const x = ((t / 30 + i * 36) % 160) - 24;
      import("../render/sprites").then(({ drawAnimal }) => {
        drawAnimal(ctx, animals[i]!, null, Math.floor(x), 16, 3, Math.floor(t / 150) % 2 === 0 ? 0 : 1);
      });
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  el.querySelector("#startBtn")!.addEventListener("click", () => {
    audio.uiClick();
    app.navigate("#/menu");
  });

  return () => {
    cancelAnimationFrame(raf);
    audio.stopMusic();
  };
}
