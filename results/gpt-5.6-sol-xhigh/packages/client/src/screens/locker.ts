import { CONFIG, type Animal, type Hat } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { ANIMAL_LIST, HAT_LIST, animalLabel, button, el, hatLabel, panel } from "../ui.js";
import { drawAnimalTiny } from "../render/sprites.js";

export function createLockerScreen(): Screen {
  return {
    id: "locker",
    mount(ctx: AppCtx, params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const back = (params["back"] as string | undefined) ?? "menu";
      const { root, body } = panel("LOCKER", "PICK YOUR LOOK", true);

      const previewCanvas = el("canvas", { attrs: { width: "64", height: "64" }, style: { width: "64px", height: "64px", imageRendering: "pixelated", background: "rgba(126,228,255,0.2)", border: "2px solid #1d3a72", borderRadius: "4px" } }) as HTMLCanvasElement;
      const pctx = previewCanvas.getContext("2d");
      if (pctx) pctx.imageSmoothingEnabled = false;

      const nameEl = el("div", { class: ["sc-title"], text: "", style: { fontSize: "13px" } });
      const hatEl = el("div", { class: ["sc-sub"], text: "" });
      const previewCard = el("div", { class: ["sc-card"], style: { background: "rgba(10,37,73,0.55)", padding: "10px" } }, [
        el("div", { class: ["sc-row", "between"] }, [
          el("div", { class: ["sc-stack"], style: { gap: "2px" } }, [nameEl, hatEl]),
          previewCanvas
        ])
      ]);
      body.append(previewCard);

      const animalGrid = el("div", { class: ["sc-grid", "cols-3"] });
      const hatGrid = el("div", { class: ["sc-grid", "cols-3"] });
      body.append(el("div", { class: ["sc-tiny", "sc-dim"], text: "ANIMAL" }), animalGrid);
      body.append(el("div", { class: ["sc-tiny", "sc-dim"], text: "HAT" }, undefined), hatGrid);

      let current = ctx.cosmetics.get();

      function refresh(): void {
        nameEl.textContent = animalLabel(current.animal);
        hatEl.textContent = `HAT: ${hatLabel(current.hat)}`;
        if (pctx) {
          pctx.clearRect(0, 0, 64, 64);
          pctx.fillStyle = "rgba(126,228,255,0.25)";
          pctx.fillRect(0, 0, 64, 64);
          drawAnimalTiny(pctx, 32, 36, 3, current, performance.now());
        }
      }
      refresh();

      function selectAnimal(a: Animal): void {
        current = ctx.cosmetics.setAnimal(a);
        ctx.net.send({ type: "set_cosmetic", animal: a, hat: current.hat });
        audio.play("tab");
        refresh();
        markActive();
      }
      function selectHat(h: Hat): void {
        current = ctx.cosmetics.setHat(h);
        ctx.net.send({ type: "set_cosmetic", animal: current.animal, hat: h });
        audio.play("tab");
        refresh();
        markActive();
      }

      const animalButtons: HTMLButtonElement[] = [];
      const hatButtons: HTMLButtonElement[] = [];

      for (const a of ANIMAL_LIST) {
        const required = CONFIG.UNLOCK_LEVELS.animals[a];
        const locked = (ctx.profile()?.level ?? 1) < required;
        const b = button(locked ? `${animalLabel(a)} · L${required}` : animalLabel(a), () => selectAnimal(a), { variant: "ghost", size: "tiny" });
        b.disabled = locked;
        if (locked) b.style.opacity = "0.45";
        animalButtons.push(b);
        animalGrid.append(b);
      }
      for (const h of HAT_LIST) {
        const required = CONFIG.UNLOCK_LEVELS.hats[h];
        const locked = (ctx.profile()?.level ?? 1) < required;
        const b = button(locked ? `${hatLabel(h)} · L${required}` : hatLabel(h), () => selectHat(h), { variant: "ghost", size: "tiny" });
        b.disabled = locked;
        if (locked) b.style.opacity = "0.45";
        hatButtons.push(b);
        hatGrid.append(b);
      }

      function markActive(): void {
        animalButtons.forEach((b, i) => {
          const a = ANIMAL_LIST[i]!;
          b.classList.toggle("mint", a === current.animal);
          b.classList.toggle("ghost", a !== current.animal);
        });
        hatButtons.forEach((b, i) => {
          const h = HAT_LIST[i]!;
          b.classList.toggle("pink", h === current.hat);
          b.classList.toggle("ghost", h !== current.hat);
        });
      }
      markActive();

      body.append(el("div", { class: ["sc-divider"] }));
      body.append(button("BACK", () => { audio.play("back"); ctx.go(back as never); }, { variant: "ghost" }));

      const off = ctx.cosmetics.subscribe((c) => { current = c; refresh(); markActive(); });

      return { root, unmount() { off(); } };
    }
  };
}
